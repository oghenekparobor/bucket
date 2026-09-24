import { Keypair } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedFixtures } from '../scripts/seedFixtures.js';
import { buildApp } from '../src/api/app.js';
import { BucketAuthenticator, signDevToken } from '../src/api/auth.js';
import { config } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import { freshDb } from './helpers/db.js';
import { FakeGateway } from './helpers/fakeGateway.js';

// §3 CatalogToken plus the additive eligibilityReason / deadline fields.
const CATALOG_TOKEN = ['assetType', 'deadline', 'decimals', 'eligibilityReason', 'eligible', 'flagged', 'liquidityUsd', 'logo', 'markPrice', 'maxWeightPct', 'mint', 'name', 'price', 'source', 'ticker'];
const CREATOR_REF = ['displayName', 'wallet', 'xHandle', 'xVerified'];
const SUMMARY = ['address', 'ageDays', 'creator', 'eligible', 'holders', 'maxDrawdown', 'name', 'returns', 'slug', 'status', 'topHoldings', 'totalBacked', 'unitPrice'];
// §3 BucketDetail plus the additive fundingState field.
const DETAIL_EXTRA = ['createdAt', 'eventCount', 'fundingState', 'holdings', 'hwm', 'lastSettledAt', 'pendingEdit', 'poolPrice', 'preIpoSharePct', 'premiumPct', 'shareUrl', 'supply', 'thesis', 'tokenMint', 'vault', 'version', 'versions'];
const HOLDING = ['assetType', 'balance', 'contributionPct', 'markGapPct', 'markPrice', 'mint', 'name', 'price', 'source', 'ticker', 'valueUsd', 'weightPct'];
const keys = (o: object) => Object.keys(o).sort();

let db: Db;
let app: FastifyInstance;
const gateway = new FakeGateway();
const me = Keypair.generate();
const wallet = me.publicKey.toBase58();
const auth = (kp = me) => ({ authorization: `Bearer ${signDevToken(kp.secretKey, kp.publicKey.toBase58())}` });
const get = async (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers });
const post = async (url: string, payload: unknown, headers: Record<string, string> = auth()) => app.inject({ method: 'POST', url, payload: payload as object, headers });
let frontier: { address: string; creator: string };
let mints: Record<string, string>;

beforeAll(async () => {
  db = await freshDb();
  await seedFixtures(db);
  app = await buildApp({ db, gateway, auth: new BucketAuthenticator(db, { devMode: true, devMaxAgeSecs: 86_400, privy: null }), cfg: { ...config, WRITE_RATE_LIMIT_PER_MIN: 60 } });
  frontier = (await db.query(`SELECT b.address, b.creator FROM buckets b JOIN bucket_slugs s ON s.bucket = b.address WHERE s.slug = 'frontier-labs'`)).rows[0];
  mints = Object.fromEntries((await db.query('SELECT ticker, mint FROM assets')).rows.map((r) => [r.ticker, r.mint]));
}, 180_000);
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('public reads', () => {
  it('GET /v1/health', async () => {
    const r = await get('/v1/health');
    expect(r.statusCode).toBe(200);
    expect(keys(r.json())).toEqual(['cluster', 'corsOrigins', 'lastSync', 'ok', 'programId', 'worker']);
    // Whether a worker has ever run here, and how its last catalog attempt went — the difference
    // between "start the worker" and "the catalog job is failing" when the app is empty.
    expect(keys(r.json().worker)).toEqual(['catalog', 'lastRunAt']);
    // The CORS allow-list is reported so a misconfigured deploy can be diagnosed with one curl.
    expect(r.json().corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('GET /v1/catalog with search and source filter', async () => {
    const all = (await get('/v1/catalog')).json();
    expect(all.tokens).toHaveLength(20);
    expect(keys(all.tokens[0])).toEqual(CATALOG_TOKEN);
    expect(keys(all)).toEqual(['syncedAt', 'tokens']);
    const nv = (await get('/v1/catalog?q=nvid')).json();
    expect(nv.tokens.map((t: { ticker: string }) => t.ticker)).toEqual(['NVDAx']);
    const pre = (await get('/v1/catalog?source=PreStocks')).json();
    expect(pre.tokens.every((t: { assetType: string; maxWeightPct: number }) => t.assetType === 'pre_ipo' && t.maxWeightPct === 25)).toBe(true);
    expect((await get('/v1/catalog?source=Nasdaq')).statusCode).toBe(400);
  });

  it('GET /v1/stats', async () => {
    const s = (await get('/v1/stats')).json();
    expect(keys(s)).toEqual(['backers', 'bucketCount', 'commissionPaid', 'creatorsPaid', 'medianPoolGapPct', 'shareLinkBackerPct', 'totalBacked']);
    expect(s.bucketCount).toBe(6);
    expect(s.shareLinkBackerPct).toBeGreaterThan(50);
  });

  it('GET /v1/leaderboard ranks every bucket by return for the period (30d default)', async () => {
    const lb = (await get('/v1/leaderboard')).json();
    expect(lb.period).toBe('30d');
    expect(lb.rows).toHaveLength(6);
    expect(keys(lb.rows[0])).toEqual([...SUMMARY, 'rank', 'return', 'spark'].sort());
    expect(keys(lb.rows[0].creator)).toEqual(CREATOR_REF);
    const returns = lb.rows.map((r: { return: number }) => r.return);
    expect(returns).toEqual([...returns].sort((a, b) => b - a));
    expect(lb.rows[0].spark.length).toBeGreaterThan(10);
    expect((await get('/v1/leaderboard?period=1y')).statusCode).toBe(400);
  });

  it('GET /v1/buckets/:slugOrAddress returns BucketDetail by slug or address', async () => {
    const d = (await get('/v1/buckets/frontier-labs')).json();
    expect(keys(d)).toEqual([...SUMMARY, ...DETAIL_EXTRA].sort());
    expect(keys(d.holdings[0])).toEqual(HOLDING);
    expect(d.versions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(d.pendingEdit.diff).toContainEqual({ ticker: 'tSTRIPE', fromPct: null, toPct: 15 });
    expect(d.shareUrl).toBe('https://bucket.xyz/b/frontier-labs');
    const sum = d.holdings.reduce((a: number, h: { contributionPct: number }) => a + h.contributionPct, 0);
    expect(sum).toBeCloseTo(d.returns['30d'], 0);
    expect((await get(`/v1/buckets/${frontier.address}`)).json().slug).toBe('frontier-labs');
    expect((await get('/v1/buckets/does-not-exist')).statusCode).toBe(404);
  });

  it('GET /v1/buckets/:slugOrAddress/token.json serves the off-chain half of the token metadata', async () => {
    // Wallets fetch this from the `uri` stored on chain; without it a bucket token has no
    // description or image anywhere it is displayed.
    const res = await get('/v1/buckets/frontier-labs/token.json');
    expect(res.statusCode).toBe(200);
    const meta = res.json();
    expect(meta.name).toBe('Frontier Labs');
    expect(meta.symbol).toBe('FRONTIERLA'); // derived from the name, 10 chars, as the program does
    expect(meta.image).toMatch(/\/og\/b\/frontier-labs\.png$/);
    expect(meta.external_url).toMatch(/\/b\/frontier-labs$/);
    expect(meta.description.length).toBeGreaterThan(0);
    // Reachable by address too, because that is what the program stores in the uri.
    expect((await get(`/v1/buckets/${frontier.address}/token.json`)).json().symbol).toBe('FRONTIERLA');
    expect((await get('/v1/buckets/does-not-exist/token.json')).statusCode).toBe(404);
  });

  it('GET /v1/buckets/:slug/chart downsamples by period', async () => {
    const week = (await get('/v1/buckets/frontier-labs/chart?period=7d')).json().points;
    const all = (await get('/v1/buckets/frontier-labs/chart?period=all')).json().points;
    expect(keys(week[0])).toEqual(['hwm', 't', 'unitPrice']);
    expect(week.length).toBeGreaterThan(150);
    expect(all.length).toBeLessThan(260);
  });

  it('GET /v1/creators/:wallet', async () => {
    const c = (await get(`/v1/creators/${frontier.creator}`)).json();
    expect(keys(c)).toEqual(['buckets', 'creator', 'totals']);
    expect(c.creator).toMatchObject({ displayName: 'Amara Eze', xHandle: '@amaraonchain', xVerified: true });
    expect(keys(c.totals)).toEqual(['bucketCount', 'commissionEarned', 'holders', 'openBuckets', 'totalBacked']);
  });

  it('GET /v1/quote/mint and /v1/quote/redeem', async () => {
    const q = (await get('/v1/quote/mint?bucket=frontier-labs&amount=250')).json();
    expect(keys(q)).toEqual(['chosen', 'feeUsd', 'legs', 'rentUsd', 'routes', 'unitPrice']);
    expect(keys(q.routes[0])).toEqual(['available', 'costUsd', 'effectivePrice', 'effectiveVsUnitPct', 'kind', 'reason', 'tokensOut']);
    expect(q).toMatchObject({ chosen: 'mint', feeUsd: '0.50' });
    // Fixtures seed pool prices, but pool swaps are not quoted until the Meteora integration exists.
    expect(q.routes[1]).toMatchObject({ kind: 'pool', available: false, reason: 'pool_quotes_not_supported' });
    expect((await get('/v1/quote/mint?bucket=frontier-labs&amount=0.5')).json().routes[0]).toMatchObject({ available: false, reason: 'below_minimum' });
    const r = (await get('/v1/quote/redeem?bucket=frontier-labs&tokens=1000000')).json();
    expect(r.routes[0]).toHaveProperty('usdcOut');
    expect(Number(r.routes[0].effectiveVsUnitPct)).toBeLessThan(0);
  });

  it('GET /v1/orders/:address for mint and redeem orders', async () => {
    const m = (await db.query(`SELECT address FROM mint_orders LIMIT 1`)).rows[0].address;
    const o = (await get(`/v1/orders/${m}`)).json();
    expect(keys(o)).toEqual(['kind', 'legs', 'status', 'tokens', 'usdc']);
    expect(o).toMatchObject({ kind: 'mint', status: 'done' });
    expect(keys(o.legs[0])).toEqual(['status', 'ticker', 'weightPct']);
    const rd = (await db.query(`SELECT address FROM redeem_orders LIMIT 1`)).rows[0].address;
    expect((await get(`/v1/orders/${rd}`)).json().kind).toBe('redeem');
    expect((await get(`/v1/orders/${wallet}`)).statusCode).toBe(404);
  });

  it('GET /og/b/:slug.png and /og/pnl/:slug.png render cached PNGs', async () => {
    const card = await get('/og/b/frontier-labs.png');
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toBe('image/png');
    expect(card.rawPayload.readUInt32BE(16)).toBe(1200);
    const pnl = await get(`/og/pnl/frontier-labs.png?period=all&wallet=${frontier.creator}&dollars=1`);
    expect(pnl.statusCode).toBe(200);
    expect(pnl.rawPayload.readUInt32BE(20)).toBe(1350);
    expect((await get('/og/b/nope.png')).statusCode).toBe(404);
    expect((await get('/og/b/%3Cscript%3E.png')).statusCode).toBe(400);
  });

  it('POST /v1/events/link-click records attribution', async () => {
    expect((await post('/v1/events/link-click', { slug: 'frontier-labs', ref: 'x' }, {})).json()).toEqual({ ok: true });
    expect((await post('/v1/events/link-click', { slug: 'nope' }, {})).statusCode).toBe(400);
  });

  it('sends CORS headers for the web origin', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/health', headers: { origin: config.WEB_ORIGIN } });
    expect(r.headers['access-control-allow-origin']).toBe(config.WEB_ORIGIN);
  });
});

describe('authenticated routes', () => {
  it('rejects writes and /me without a valid token', async () => {
    expect((await get('/v1/me')).statusCode).toBe(401);
    expect((await post('/v1/tx/mint', { bucket: 'frontier-labs', amountUsd: '10' }, {})).statusCode).toBe(401);
    expect((await get('/v1/me', { authorization: 'Bearer dev:abc:1:xyz' })).statusCode).toBe(401);
  });

  it('GET /v1/me returns the wallet and balances', async () => {
    const r = (await get('/v1/me', auth())).json();
    expect(r).toMatchObject({ userId: `dev:${wallet}`, wallet, usdcBalance: '4820.55', solBalance: '1.500000000' });
  });

  it('GET /v1/me/portfolio values positions against cost basis', async () => {
    await db.query(`INSERT INTO positions (wallet, bucket, tokens, cost_e6, first_entry_at) VALUES ($1, $2, 8100000, 1500000000, now())`, [wallet, frontier.address]);
    const p = (await get('/v1/me/portfolio', auth())).json();
    expect(keys(p.positions[0])).toEqual(['bucket', 'gainPct', 'gainUsd', 'paid', 'tokens', 'unitPrice', 'value']);
    expect(p.positions[0]).toMatchObject({ tokens: '8100000', paid: '1500.00' });
    expect(keys(p.totals)).toEqual(['commissionPaid', 'gainPct', 'gainUsd', 'paid', 'value']);
  });

  it('GET /v1/me/dashboard', async () => {
    const d = (await get('/v1/me/dashboard', auth())).json();
    expect(keys(d)).toEqual(['backersByDay', 'buckets', 'commission', 'funnel']);
    expect(d.backersByDay).toHaveLength(30);
  });

  it('POST /v1/me/notifications stores an email or Telegram chat for a wallet-only user', async () => {
    expect((await post('/v1/me/notifications', { email: 'me@example.com' })).json()).toEqual({ email: 'me@example.com', telegramChatId: null });
    expect((await post('/v1/me/notifications', { telegramChatId: '12345' })).json()).toEqual({ email: 'me@example.com', telegramChatId: '12345' });
    expect((await post('/v1/me/notifications', { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await get('/v1/me/notifications', auth())).json()).toHaveProperty('notifications');
  });

  it('POST /v1/tx/create-bucket validates the recipe, builds transactions and reserves the slug', async () => {
    const bad = await post('/v1/tx/create-bucket', { name: 'X', thesis: '', holdings: [{ mint: mints.NVDAx, weightPct: 60 }, { mint: mints.pOPENAI, weightPct: 40 }], stakeUsd: '10' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toEqual(['NVDAx: weight must be 2% to 50%', 'pOPENAI: weight must be 2% to 25%', 'Creator stake must be at least $25']);
    const ok = await post('/v1/tx/create-bucket', { name: 'Frontier Labs', thesis: 'Again', holdings: [{ mint: mints.NVDAx, weightPct: 50 }, { mint: mints.SPYx, weightPct: 50 }], stakeUsd: '25' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ transactions: ['dHgx', 'dHgy'], slug: 'frontier-labs-2' });
    expect(gateway.calls.at(-1)).toMatchObject({ method: 'buildCreateBucketTxs', args: { creator: wallet, stakeE6: 25_000_000n } });
    const chain = await db.query(`SELECT lookup_table FROM bucket_chain WHERE bucket = $1`, [ok.json().bucket]);
    expect(chain.rowCount).toBe(1);
  });

  it('POST /v1/tx/mint, /redeem, /submit and /faucet call the gateway', async () => {
    expect((await post('/v1/tx/mint', { bucket: 'frontier-labs', amountUsd: '250' })).json()).toEqual({ transaction: 'bWludA==', order: 'So11111111111111111111111111111111111111112' });
    expect(gateway.calls.at(-1)).toMatchObject({ args: { amountE6: 250_000_000n, bucket: frontier.address } });
    expect((await post('/v1/tx/mint', { bucket: 'frontier-labs', amountUsd: '0.50' })).statusCode).toBe(400);
    expect((await post('/v1/tx/mint', { bucket: 'nope', amountUsd: '5' })).statusCode).toBe(404);
    expect((await post('/v1/tx/redeem', { bucket: 'frontier-labs', tokens: '1000000' })).json().order).toBeDefined();
    expect((await post('/v1/tx/submit', { transaction: 'A'.repeat(100) })).json()).toEqual({ signature: '5igSig' });
    expect((await post('/v1/faucet', {})).json()).toMatchObject({ signature: 'sigFaucet' });
  });

  it('only the creator can close, rename or edit a bucket', async () => {
    expect((await post('/v1/tx/close-bucket', { bucket: 'frontier-labs' })).statusCode).toBe(403);
    expect((await post('/v1/tx/update-info', { bucket: 'frontier-labs', name: 'Mine', thesis: '' })).statusCode).toBe(403);
    const edit = await post('/v1/tx/propose-edit', { bucket: 'frontier-labs', holdings: [{ mint: mints.NVDAx, weightPct: 50 }, { mint: mints.SPYx, weightPct: 50 }], note: 'x' });
    expect(edit.statusCode).toBe(403);
  });

  it('rate limits writes', async () => {
    const limited = await buildApp({ db, gateway, auth: new BucketAuthenticator(db, { devMode: true, devMaxAgeSecs: 86_400, privy: null }), cfg: { ...config, WRITE_RATE_LIMIT_PER_MIN: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await limited.inject({ method: 'POST', url: '/v1/events/link-click', payload: { slug: 'frontier-labs' } })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    await limited.close();
  });
});

describe('geo-restrictions (config/geo-restrictions.json)', () => {
  const from = (country: string, extra: Record<string, string> = {}) => ({ ...auth(), 'cf-ipcountry': country, ...extra });
  const nonPreIpo = () => [{ mint: mints.SPYx, weightPct: 50 }, { mint: mints.NVDAx, weightPct: 50 }];

  it('returns 451 for any write from a blockAll country, but never for redeem', async () => {
    const mint = await post('/v1/tx/mint', { bucket: 'everything-index', amountUsd: '10' }, from('US'));
    expect(mint.statusCode).toBe(451);
    expect(mint.json().error).toBe('unavailable_for_legal_reasons');
    expect((await post('/v1/tx/create-bucket', { name: 'Geo', thesis: '', holdings: nonPreIpo(), stakeUsd: '25' }, from('US'))).statusCode).toBe(451);
    expect((await post('/v1/tx/redeem', { bucket: 'everything-index', tokens: '1000' }, from('US'))).statusCode).toBe(200);
  });

  it('blocks pre-IPO buckets only for blockPreIpo countries', async () => {
    expect((await post('/v1/tx/mint', { bucket: 'frontier-labs', amountUsd: '10' }, from('SG'))).statusCode).toBe(451);
    expect((await post('/v1/tx/mint', { bucket: 'everything-index', amountUsd: '10' }, from('SG'))).statusCode).toBe(200);
    const preIpo = [{ mint: mints.SPYx, weightPct: 75 }, { mint: mints.pOPENAI, weightPct: 25 }];
    expect((await post('/v1/tx/create-bucket', { name: 'Geo pre', thesis: '', holdings: preIpo, stakeUsd: '25' }, from('SG'))).statusCode).toBe(451);
    expect((await post('/v1/tx/create-bucket', { name: 'Geo ok', thesis: '', holdings: nonPreIpo(), stakeUsd: '25' }, from('sg'))).statusCode).toBe(200);
    expect((await post('/v1/tx/mint', { bucket: 'frontier-labs', amountUsd: '10' }, from('DE'))).statusCode).toBe(200);
  });

  it('applies region blocks and reads the Vercel header too', async () => {
    const r = await post('/v1/tx/mint', { bucket: 'everything-index', amountUsd: '10' }, from('UA', { 'cf-region-code': '43' }));
    expect(r.statusCode).toBe(451);
    const vercel = { ...auth(), 'x-vercel-ip-country': 'CU' };
    expect((await post('/v1/tx/mint', { bucket: 'everything-index', amountUsd: '10' }, vercel)).statusCode).toBe(451);
  });

  it('relays for restricted users only transactions Bucket built, or pure exits', async () => {
    const tx = { transaction: 'A'.repeat(100) };
    gateway.inspection = { sponsored: false, instructions: ['open_mint'] };
    expect((await post('/v1/tx/submit', tx, from('US'))).statusCode).toBe(451);
    gateway.inspection = { sponsored: false, instructions: ['redeem', 'claim_redeem_in_kind'] };
    expect((await post('/v1/tx/submit', tx, from('US'))).statusCode).toBe(200);
    gateway.inspection = { sponsored: true, instructions: ['open_mint'] };
    expect((await post('/v1/tx/submit', tx, from('US'))).statusCode).toBe(200);
  });
});
