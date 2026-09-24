import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { webOrigins } from '../../config.js';
import { deriveSymbol, truncateName } from '@bucket/sdk';
import { chartStepMs } from '../../perf/metrics.js';
import { big, roundPct, usdToE6 } from '../../util/money.js';
import { DAY_MS, PERIODS, type Period, floorHour, periodDays } from '../../util/time.js';
import type { AppContext } from '../app.js';
import { hashClient } from '../attribution.js';
import { badRequest, notFound, parse } from '../errors.js';
import { loadQuoteContext, programParams, quoteMint, quoteRedeem } from '../quote.js';
import { creatorRef, loadCatalog, loadDetail, loadSummaries, resolveBucket, usd } from '../views.js';

const periodSchema = z.enum(PERIODS as [Period, ...Period[]]);
const address = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be a base58 address');
const usdAmount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, 'must be a USD decimal string');
const rawAmount = z.string().regex(/^\d{1,20}$/, 'must be an integer amount in base units');

export function registerPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cfg } = ctx;

  app.get('/v1/health', async () => {
    const [sync, db_ok] = await Promise.all([
      db.query(`SELECT finished_at FROM job_runs WHERE job = 'catalog' AND ok ORDER BY finished_at DESC LIMIT 1`),
      db.query('SELECT 1').then(() => true).catch(() => false),
    ]);
    return {
      ok: db_ok,
      cluster: cfg.CLUSTER,
      programId: cfg.PROGRAM_ID,
      lastSync: sync.rows[0]?.finished_at?.toISOString() ?? null,
      // The browser origins this API answers CORS for. Not a secret (a matching browser sees it in
      // the response header anyway), and the fastest way to see why the app is getting CORS errors.
      corsOrigins: webOrigins(cfg),
    };
  });

  app.get('/v1/catalog', async (req) => {
    const q = parse(z.object({ q: z.string().max(64).optional(), source: z.enum(['xStocks', 'PreStocks', 'Tessera']).optional() }), req.query);
    const [tokens, synced] = await Promise.all([
      loadCatalog(db, q),
      db.query(`SELECT finished_at FROM job_runs WHERE job IN ('catalog', 'prices') AND ok ORDER BY finished_at DESC LIMIT 1`),
    ]);
    return { tokens, syncedAt: synced.rows[0]?.finished_at?.toISOString() ?? null };
  });

  app.get('/v1/stats', async () => {
    const r = await db.query(
      `SELECT
         (SELECT COALESCE(sum(m.vault_value_e6), 0) FROM bucket_metrics m) AS total_backed,
         (SELECT count(*) FROM buckets) AS bucket_count,
         (SELECT count(DISTINCT wallet) FROM positions WHERE paid_total_e6 > 0) AS backers,
         (SELECT COALESCE(sum(commission_e6), 0) FROM commission_settlements) AS commission_paid,
         (SELECT count(DISTINCT b.creator) FROM commission_settlements c JOIN buckets b ON b.address = c.bucket WHERE c.creator_tokens > 0) AS creators_paid,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(p.price_e6 / m.unit_price_e6 - 1) * 100)
            FROM bucket_metrics m JOIN LATERAL (SELECT price_e6 FROM pool_prices WHERE bucket = m.bucket ORDER BY ts DESC LIMIT 1) p ON true
            WHERE m.unit_price_e6 > 0) AS median_gap,
         (SELECT 100.0 * count(*) FILTER (WHERE via_link) / NULLIF(count(*), 0) FROM (
            SELECT DISTINCT ON (wallet) via_link FROM backer_attributions ORDER BY wallet, created_at) first) AS link_pct`,
    );
    const s = r.rows[0];
    return {
      totalBacked: usd(big(s.total_backed)),
      bucketCount: Number(s.bucket_count),
      backers: Number(s.backers),
      commissionPaid: usd(big(s.commission_paid)),
      creatorsPaid: Number(s.creators_paid),
      medianPoolGapPct: s.median_gap === null ? null : roundPct(Number(s.median_gap)),
      shareLinkBackerPct: s.link_pct === null ? null : roundPct(Number(s.link_pct), 1),
    };
  });

  app.get('/v1/leaderboard', async (req) => {
    const { period } = parse(z.object({ period: periodSchema.default('30d') }), req.query);
    const snap = await db.query(`SELECT id, computed_at FROM leaderboard_snapshots WHERE period = $1 ORDER BY id DESC LIMIT 1`, [period]);
    const s = snap.rows[0];
    if (!s) return { period, updatedAt: null, rows: [] };
    const rows = await db.query(`SELECT rank, bucket, ret, spark FROM leaderboard_rows WHERE snapshot_id = $1 ORDER BY rank`, [s.id]);
    const summaries = await loadSummaries(db, { addresses: rows.rows.map((r) => r.bucket) });
    return {
      period,
      updatedAt: s.computed_at.toISOString(),
      rows: rows.rows
        .filter((r) => summaries.has(r.bucket))
        .map((r) => ({ ...summaries.get(r.bucket)!, rank: r.rank, return: r.ret === null ? null : roundPct(r.ret), spark: r.spark })),
    };
  });

  app.get('/v1/buckets/:slugOrAddress', async (req) => {
    const { slugOrAddress } = parse(z.object({ slugOrAddress: z.string().min(1).max(64) }), req.params);
    const addr = await resolveBucket(db, slugOrAddress);
    const detail = addr ? await loadDetail(db, addr) : null;
    if (!detail) throw notFound('Bucket');
    return detail;
  });

  /**
   * The off-chain half of a bucket token's Metaplex metadata: wallets and explorers fetch this from
   * the `uri` stored on chain. The on-chain account already carries the name and ticker; this adds
   * the description and image, and is served live so a rename shows up without touching the chain.
   */
  app.get('/v1/buckets/:slugOrAddress/token.json', async (req, reply) => {
    const { slugOrAddress } = parse(z.object({ slugOrAddress: z.string().min(1).max(64) }), req.params);
    const addr = await resolveBucket(db, slugOrAddress);
    const row = addr
      ? (
          await db.query<{ name: string; thesis: string; slug: string | null; token_mint: string }>(
            `SELECT b.name, b.thesis, b.token_mint, s.slug FROM buckets b LEFT JOIN bucket_slugs s ON s.bucket = b.address WHERE b.address = $1`,
            [addr],
          )
        ).rows[0]
      : undefined;
    if (!row) throw notFound('Bucket');
    const site = cfg.PUBLIC_WEB_URL.replace(/\/$/, '');
    const api = cfg.PUBLIC_API_URL.replace(/\/$/, '');
    const slug = row.slug ?? addr!;
    reply.header('cache-control', 'public, max-age=300');
    return {
      name: truncateName(row.name),
      symbol: deriveSymbol(row.name),
      description: row.thesis || `A Bucket holding tokenized stocks. ${site}/b/${slug}`,
      image: `${api}/og/b/${slug}.png`,
      external_url: `${site}/b/${slug}`,
      // Wallets that follow the Metaplex off-chain standard read these two.
      seller_fee_basis_points: 0,
      properties: { category: 'image', files: [{ uri: `${api}/og/b/${slug}.png`, type: 'image/png' }] },
    };
  });

  app.get('/v1/buckets/:slug/chart', async (req) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(64) }), req.params);
    const { period } = parse(z.object({ period: periodSchema.default('30d') }), req.query);
    const addr = await resolveBucket(db, slug);
    if (!addr) throw notFound('Bucket');
    const days = periodDays(period);
    const bounds = await db.query(`SELECT min(hour) AS first, max(hour) AS last FROM unit_price_hourly WHERE bucket = $1`, [addr]);
    const first: Date | null = bounds.rows[0]?.first ?? null;
    const last: Date | null = bounds.rows[0]?.last ?? null;
    if (!first || !last) {
      // Younger than an hour: the $100 launch point and the live unit price.
      const b = await db.query(
        `SELECT b.created_at, b.hwm_e6, m.unit_price_e6, m.computed_at FROM buckets b LEFT JOIN bucket_metrics m ON m.bucket = b.address WHERE b.address = $1`,
        [addr],
      );
      const row = b.rows[0];
      if (!row?.unit_price_e6) return { points: [] };
      return {
        points: [
          { t: row.created_at.toISOString(), unitPrice: 100, hwm: 100 },
          { t: row.computed_at.toISOString(), unitPrice: Number(row.unit_price_e6) / 1e6, hwm: Number(row.hwm_e6) / 1e6 },
        ],
      };
    }
    const from = floorHour(days === null ? first.getTime() : Math.max(first.getTime(), last.getTime() - days * DAY_MS));
    const step = chartStepMs(period, last.getTime() - from);
    const r = await db.query(
      `SELECT hour, unit_price_e6, hwm_e6 FROM unit_price_hourly
       WHERE bucket = $1 AND hour >= $2 AND (extract(epoch FROM hour)::bigint * 1000 - $3::bigint) % $4::bigint = 0
       ORDER BY hour`,
      [addr, new Date(from), from % step, step],
    );
    const metrics = await db.query(`SELECT unit_price_e6, computed_at FROM bucket_metrics WHERE bucket = $1`, [addr]);
    const points = r.rows.map((p) => ({ t: p.hour.toISOString(), unitPrice: Number(p.unit_price_e6) / 1e6, hwm: Number(p.hwm_e6) / 1e6 }));
    const live = metrics.rows[0];
    if (live?.unit_price_e6 && points.length && live.computed_at.getTime() > r.rows.at(-1)!.hour.getTime()) {
      points.push({ t: live.computed_at.toISOString(), unitPrice: Number(live.unit_price_e6) / 1e6, hwm: points.at(-1)!.hwm });
    }
    return { points };
  });

  app.get('/v1/creators/:wallet', async (req) => {
    const { wallet } = parse(z.object({ wallet: address }), req.params);
    const [user, summaries, earned] = await Promise.all([
      db.query(`SELECT display_name, x_handle, x_verified FROM users WHERE wallet = $1`, [wallet]),
      loadSummaries(db, { creator: wallet }),
      db.query(`SELECT COALESCE(sum(commission_earned_e6), 0) AS earned FROM positions WHERE wallet = $1`, [wallet]),
    ]);
    const buckets = [...summaries.values()];
    if (buckets.length === 0 && user.rowCount === 0) throw notFound('Creator');
    return {
      creator: creatorRef(wallet, user.rows[0]),
      buckets,
      totals: {
        totalBacked: usd(buckets.reduce((a, b) => a + usdToE6(b.totalBacked), 0n)),
        bucketCount: buckets.length,
        openBuckets: buckets.filter((b) => b.status === 'open').length,
        holders: buckets.reduce((a, b) => a + b.holders, 0),
        commissionEarned: usd(big(earned.rows[0].earned)),
      },
    };
  });

  app.get('/v1/quote/mint', async (req) => {
    const q = parse(z.object({ bucket: z.string().min(1).max(64), amount: usdAmount }), req.query);
    const addr = await resolveBucket(db, q.bucket);
    const qc = addr ? await loadQuoteContext(db, addr) : null;
    if (!qc) throw notFound('Bucket');
    return quoteMint(qc, usdToE6(q.amount), programParams(cfg));
  });

  app.get('/v1/quote/redeem', async (req) => {
    const q = parse(z.object({ bucket: z.string().min(1).max(64), tokens: rawAmount }), req.query);
    const addr = await resolveBucket(db, q.bucket);
    const qc = addr ? await loadQuoteContext(db, addr) : null;
    if (!qc) throw notFound('Bucket');
    return quoteRedeem(qc, BigInt(q.tokens), programParams(cfg));
  });

  app.get('/v1/orders/:address', async (req) => {
    const { address: order } = parse(z.object({ address }), req.params);
    const mint = await db.query(
      `SELECT o.status, o.amount_e6, o.net_e6, o.tokens_total,
         json_agg(json_build_object('ticker', COALESCE(a.ticker, l.mint), 'budget', l.budget_e6::text, 'status', l.status) ORDER BY l.leg) AS legs
       FROM mint_orders o JOIN mint_order_legs l ON l.order_address = o.address LEFT JOIN assets a ON a.mint = l.mint
       WHERE o.address = $1 GROUP BY o.address`,
      [order],
    );
    if (mint.rows[0]) {
      const o = mint.rows[0];
      const net = Number(o.net_e6) || 1;
      return {
        kind: 'mint',
        status: o.status,
        legs: o.legs.map((l: { ticker: string; budget: string; status: string }) => ({ ticker: l.ticker, weightPct: roundPct((Number(l.budget) / net) * 100, 1), status: l.status })),
        tokens: big(o.tokens_total).toString(),
        usdc: usd(big(o.amount_e6)),
      };
    }
    const redeem = await db.query(
      `SELECT o.status, o.tokens_burned, o.usdc_out_e6,
         json_agg(json_build_object('ticker', COALESCE(a.ticker, l.mint), 'weight', COALESCE(h.weight_bps, 0), 'status', l.status) ORDER BY l.leg) AS legs
       FROM redeem_orders o JOIN redeem_order_legs l ON l.order_address = o.address LEFT JOIN assets a ON a.mint = l.mint
       LEFT JOIN holdings h ON h.bucket = o.bucket AND h.mint = l.mint
       WHERE o.address = $1 GROUP BY o.address`,
      [order],
    );
    const o = redeem.rows[0];
    if (!o) throw notFound('Order');
    return {
      kind: 'redeem',
      status: o.status,
      legs: o.legs.map((l: { ticker: string; weight: number; status: string }) => ({ ticker: l.ticker, weightPct: l.weight / 100, status: l.status })),
      tokens: big(o.tokens_burned).toString(),
      usdc: usd(big(o.usdc_out_e6)),
    };
  });

  app.post('/v1/events/link-click', { config: ctx.writeLimit }, async (req) => {
    const body = parse(z.object({ slug: z.string().min(1).max(64), ref: z.string().max(64).nullish() }), req.body);
    const bucket = await resolveBucket(db, body.slug);
    if (!bucket) throw badRequest('Unknown bucket slug');
    await db.query(`INSERT INTO link_clicks (slug, ref, ip_hash, ua_hash) VALUES ($1, $2, $3, $4)`, [
      body.slug,
      body.ref ?? null,
      hashClient(req.ip),
      hashClient(String(req.headers['user-agent'] ?? '')),
    ]);
    return { ok: true };
  });
}
