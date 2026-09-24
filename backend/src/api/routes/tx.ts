/**
 * Transaction building and relay (docs/architecture.md §3). Inputs are validated against the program's
 * rules here so users get a clear error before signing; the program re-checks everything.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EDIT_COOLDOWN_DAYS,
  MAX_ACTIVE_BUCKETS,
  NOTE_MAX_BYTES,
  type RecipeAsset,
  validateRecipe,
  validateText,
} from '../../buckets/rules.js';
import type { HoldingInput } from '../../chain/gateway.js';
import type { Queryable } from '../../db/pool.js';
import { usdToE6 } from '../../util/money.js';
import { byteLength } from '../../util/sanitize.js';
import { uniqueSlug } from '../../util/slug.js';
import { DAY_MS } from '../../util/time.js';
import type { AppContext } from '../app.js';
import { badRequest, forbidden, HttpError, notFound, parse } from '../errors.js';
import { hashClient } from '../attribution.js';
import { EXIT_INSTRUCTIONS } from '../geo.js';
import { resolveBucket } from '../views.js';

const address = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be a base58 address');
const usdAmount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, 'must be a USD decimal string');
const holdingsSchema = z.array(z.object({ mint: address, weightPct: z.number().int() })).min(1).max(20);
const FAUCET_AMOUNT_E6 = 1_000_000_000n; // 1,000 mock USDC
const ATTRIBUTION_WINDOW = '7 days';

async function loadRecipeAssets(db: Queryable, mints: string[]): Promise<Map<string, RecipeAsset>> {
  const r = await db.query(
    `SELECT mint, ticker, asset_type, eligible, flagged OR COALESCE(program_flagged, false) AS flagged FROM assets WHERE mint = ANY($1)`,
    [mints],
  );
  return new Map(r.rows.map((a) => [a.mint, { ticker: a.ticker, assetType: a.asset_type, eligible: a.eligible, flagged: a.flagged }]));
}

const hasPreIpo = (holdings: { mint: string }[], assets: Map<string, RecipeAsset>) => holdings.some((h) => assets.get(h.mint)?.assetType === 'pre_ipo');

const toHoldingInput =(h: { mint: string; weightPct: number }[]): HoldingInput[] => h.map((x) => ({ mint: x.mint, weightBps: x.weightPct * 100 }));

async function requireBucket(db: Queryable, slugOrAddress: string) {
  const addr = await resolveBucket(db, slugOrAddress);
  if (!addr) throw notFound('Bucket');
  const r = await db.query(
    `SELECT b.address, b.creator, b.status, b.last_edit_at, b.version, b.creator_funded,
       EXISTS (SELECT 1 FROM holdings h JOIN assets a ON a.mint = h.mint WHERE h.bucket = b.address AND a.asset_type = 'pre_ipo') AS holds_pre_ipo
     FROM buckets b WHERE b.address = $1`,
    [addr],
  );
  return r.rows[0]!;
}

export function registerTxRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, gateway, cfg } = ctx;
  const opts = { config: ctx.writeLimit };

  app.post('/v1/tx/create-bucket', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(
      z.object({ name: z.string().max(200), thesis: z.string().max(2000), holdings: holdingsSchema, stakeUsd: usdAmount }),
      req.body,
    );
    const name = body.name.trim();
    const thesis = body.thesis.trim();
    const assets = await loadRecipeAssets(db, body.holdings.map((h) => h.mint));
    ctx.assertGeo(req, hasPreIpo(body.holdings, assets));
    const errors = [...validateText(name, thesis), ...validateRecipe(body.holdings, assets)];
    const stakeE6 = usdToE6(body.stakeUsd);
    if (stakeE6 < usdToE6(cfg.MIN_CREATOR_DEPOSIT_USD)) errors.push(`Creator stake must be at least $${cfg.MIN_CREATOR_DEPOSIT_USD}`);
    const active = await db.query(`SELECT count(*) AS n FROM buckets WHERE creator = $1 AND status = 'open'`, [user.wallet]);
    if (Number(active.rows[0].n) >= MAX_ACTIVE_BUCKETS) errors.push(`A wallet can have at most ${MAX_ACTIVE_BUCKETS} open buckets`);
    if (errors.length) throw badRequest('Bucket does not meet the rules', errors);

    const built = await gateway.buildCreateBucketTxs({ creator: user.wallet, name, thesis, holdings: toHoldingInput(body.holdings), stakeE6 });
    // Reserve the slug now so the share link is known before the transaction lands; the indexer keeps it.
    const existing = await db.query(`SELECT slug FROM bucket_slugs WHERE bucket = $1`, [built.bucket]);
    const slug =
      existing.rows[0]?.slug ??
      (await uniqueSlug(name, async (s) => ((await db.query('SELECT 1 FROM bucket_slugs WHERE slug = $1', [s])).rowCount ?? 0) > 0));
    await db.query(`INSERT INTO bucket_slugs (bucket, slug) VALUES ($1, $2) ON CONFLICT (bucket) DO NOTHING`, [built.bucket, slug]);
    await db.query(
      `INSERT INTO bucket_chain (bucket, lookup_table) VALUES ($1, $2) ON CONFLICT (bucket) DO UPDATE SET lookup_table = EXCLUDED.lookup_table`,
      [built.bucket, built.lookupTable],
    );
    return { transactions: built.transactions, bucket: built.bucket, slug, order: built.order, optional: built.optional };
  });

  app.post('/v1/tx/mint', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ bucket: z.string().min(1).max(64), amountUsd: usdAmount }), req.body);
    const b = await requireBucket(db, body.bucket);
    ctx.assertGeo(req, b.holds_pre_ipo);
    if (b.status !== 'open') throw badRequest('This bucket is closed to new money; redeem stays open');
    const amountE6 = usdToE6(body.amountUsd);
    if (!b.creator_funded && b.creator !== user.wallet) throw badRequest("The creator's first mint has to fill completely before anyone else can mint");
    const minimum = b.creator_funded ? cfg.MIN_DEPOSIT_USD : cfg.MIN_CREATOR_DEPOSIT_USD;
    if (amountE6 < usdToE6(minimum)) throw badRequest(`Minimum is $${minimum}`);

    // Share-link attribution: a click on this bucket's link from the same client in the last week.
    const click = await db.query(
      `SELECT l.id FROM link_clicks l JOIN bucket_slugs s ON s.slug = l.slug
       WHERE s.bucket = $1 AND l.ip_hash = $2 AND l.ua_hash = $3 AND l.clicked_at > now() - $4::interval
       ORDER BY l.clicked_at DESC LIMIT 1`,
      [b.address, hashClient(req.ip), hashClient(String(req.headers['user-agent'] ?? '')), ATTRIBUTION_WINDOW],
    );
    await db.query(
      `INSERT INTO backer_attributions (wallet, bucket, click_id, via_link) VALUES ($1, $2, $3, $4) ON CONFLICT (wallet, bucket) DO NOTHING`,
      [user.wallet, b.address, click.rows[0]?.id ?? null, (click.rowCount ?? 0) > 0],
    );
    return gateway.buildMintTx({ backer: user.wallet, bucket: b.address, amountE6 });
  });

  // Never geo-blocked: holders anywhere can always exit.
  app.post('/v1/tx/redeem', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ bucket: z.string().min(1).max(64), tokens: z.string().regex(/^\d{1,20}$/) }), req.body);
    const b = await requireBucket(db, body.bucket);
    const tokens = BigInt(body.tokens);
    if (tokens <= 0n) throw badRequest('tokens must be positive');
    return gateway.buildRedeemTx({ holder: user.wallet, bucket: b.address, tokens });
  });

  app.post('/v1/tx/close-bucket', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ bucket: z.string().min(1).max(64) }), req.body);
    const b = await requireBucket(db, body.bucket);
    ctx.assertGeo(req, b.holds_pre_ipo);
    if (b.creator !== user.wallet) throw forbidden('Only the creator can close a bucket');
    if (b.status !== 'open') throw badRequest('Bucket is already closed');
    return gateway.buildCloseBucketTx({ creator: user.wallet, bucket: b.address });
  });

  /** Name and thesis are editable (product-v2 "Edit a bucket"); recipe and history are not. */
  app.post('/v1/tx/update-info', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ bucket: z.string().min(1).max(64), name: z.string().max(200), thesis: z.string().max(2000) }), req.body);
    const b = await requireBucket(db, body.bucket);
    ctx.assertGeo(req, b.holds_pre_ipo);
    if (b.creator !== user.wallet) throw forbidden('Only the creator can edit a bucket');
    const name = body.name.trim();
    const thesis = body.thesis.trim();
    const errors = validateText(name, thesis);
    if (errors.length) throw badRequest('Name or thesis does not meet the rules', errors);
    return gateway.buildUpdateInfoTx({ creator: user.wallet, bucket: b.address, name, thesis });
  });

  app.post('/v1/tx/propose-edit', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ bucket: z.string().min(1).max(64), holdings: holdingsSchema, note: z.string().max(1000).nullish() }), req.body);
    const b = await requireBucket(db, body.bucket);
    const assets = await loadRecipeAssets(db, body.holdings.map((h) => h.mint));
    ctx.assertGeo(req, b.holds_pre_ipo || hasPreIpo(body.holdings, assets));
    if (b.creator !== user.wallet) throw forbidden('Only the creator can edit a bucket');
    const note = body.note?.trim() || null;
    const errors = validateRecipe(body.holdings, assets);
    if (note && byteLength(note) > NOTE_MAX_BYTES) errors.push(`Note is at most ${NOTE_MAX_BYTES} bytes`);
    if (b.last_edit_at && Date.now() - b.last_edit_at.getTime() < EDIT_COOLDOWN_DAYS * DAY_MS) errors.push(`At most one edit per ${EDIT_COOLDOWN_DAYS} days`);
    const pending = await db.query(`SELECT 1 FROM bucket_versions WHERE bucket = $1 AND activated_at IS NULL AND version > $2`, [b.address, b.version]);
    if (pending.rowCount) errors.push('An edit is already pending');
    if (errors.length) throw badRequest('Edit does not meet the rules', errors);
    return gateway.buildProposeEditTx({ creator: user.wallet, bucket: b.address, holdings: toHoldingInput(body.holdings), note });
  });

  app.post('/v1/tx/submit', opts, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(z.object({ transaction: z.string().min(64).max(4096) }), req.body);
    if (ctx.geoRestricted(req)) {
      // From a restricted location, relay only what Bucket built after the geo check, or pure exits.
      const t = gateway.inspectTransaction(body.transaction);
      if (!t.sponsored && !t.instructions.every((name) => EXIT_INSTRUCTIONS.has(name))) ctx.assertGeo(req, true);
    }
    const signature = await gateway.submit(body.transaction, user.wallet);
    await db.query(`NOTIFY keeper_nudge`);
    return { signature };
  });

  app.post('/v1/faucet', opts, async (req) => {
    const user = await ctx.requireUser(req);
    if (cfg.CLUSTER === 'mainnet-beta') throw new HttpError(403, 'devnet_only', 'The faucet only exists on devnet');
    const signature = await gateway.faucet(user.wallet, FAUCET_AMOUNT_E6);
    return { signature, amountUsd: '1000.00' };
  });
}
