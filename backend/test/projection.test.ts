import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rebuild } from '../scripts/rebuild.js';
import type { Db } from '../src/db/pool.js';
import type { EventName, RawEvent } from '../src/indexer/events.js';
import { ingestEvents } from '../src/indexer/ingest.js';
import { freshDb } from './helpers/db.js';

const PLATFORM = 'E9D5dRD7PQDvEDTgqRLsK1V6yquTfbCSgabAUCVmdYwi';
const B = 'Bkt1111111111111111111111111111111111111111';
const CREATOR = 'Cre1111111111111111111111111111111111111111';
const BACKER = 'Bac1111111111111111111111111111111111111111';
const A = 'MintA111111111111111111111111111111111111111';
const X = 'MintX111111111111111111111111111111111111111';
const T0 = Date.parse('2026-09-01T00:00:00Z');

let seq = 0;
const ev = (name: EventName, minutes: number, data: Record<string, unknown>): RawEvent => ({
  name,
  data: { ...data, ts: String(Math.floor((T0 + minutes * 60_000) / 1000)) },
  signature: `sig-${++seq}`,
  slot: 1_000 + seq,
  eventIndex: 0,
  blockTime: new Date(T0 + minutes * 60_000),
});

// Two 6-decimal assets at $10. Creator mints $100.24 incl. rent fee, backer mints $50, prices double,
// commission settles, backer redeems half, then an edit swaps the recipe and the name changes.
const events: RawEvent[] = [
  ev('AssetAdded', 0, { mint: A, source: 'xStocks', asset_type: 'publicStock', symbol: 'AAAx', decimals: 6, token_program: 'Tokenz', price_e6: '10000000' }),
  ev('AssetAdded', 0, { mint: X, source: 'preStocks', asset_type: 'preIpo', symbol: 'pXXX', decimals: 6, token_program: 'Tokenz', price_e6: '10000000' }),
  ev('BucketCreated', 1, { bucket: B, creator: CREATOR, id: 0, token_mint: 'BktMint1111111111111111111111111111111111111', name: 'Test Bucket', thesis: 'x', holdings: [{ mint: A, weight_bps: 7500 }, { mint: X, weight_bps: 2500 }] }),
  ev('MintOpened', 2, { order: 'O1', bucket: B, backer: CREATOR, amount_e6: '100000000', fee_e6: '200000', net_e6: '99800000', rent_fee_e6: '240000', unit_price_e6: '100000000', legs: [{ mint: A, amount: '74850000' }, { mint: X, amount: '24950000' }] }),
  ev('MintFilled', 2, { order: 'O1', bucket: B, backer: CREATOR, leg: 0, mint: A, usdc_spent: '74850000', qty: '7485000', tokens: '748500', vault_balance: '7485000', supply: '748500' }),
  ev('MintFilled', 2, { order: 'O1', bucket: B, backer: CREATOR, leg: 1, mint: X, usdc_spent: '24950000', qty: '2495000', tokens: '249500', vault_balance: '2495000', supply: '998000' }),
  ev('MintClosed', 3, { order: 'O1', bucket: B, backer: CREATOR, refunded_e6: '0', tokens_total: '998000' }),
  ev('MintOpened', 10, { order: 'O2', bucket: B, backer: BACKER, amount_e6: '50000000', fee_e6: '100000', net_e6: '49900000', rent_fee_e6: '0', unit_price_e6: '100000000', legs: [{ mint: A, amount: '37425000' }, { mint: X, amount: '12475000' }] }),
  ev('MintFilled', 10, { order: 'O2', bucket: B, backer: BACKER, leg: 0, mint: A, usdc_spent: '37425000', qty: '3742500', tokens: '374250', vault_balance: '11227500', supply: '1372250' }),
  ev('MintFilled', 10, { order: 'O2', bucket: B, backer: BACKER, leg: 1, mint: X, usdc_spent: '12475000', qty: '1247500', tokens: '124750', vault_balance: '3742500', supply: '1497000' }),
  ev('MintClosed', 11, { order: 'O2', bucket: B, backer: BACKER, refunded_e6: '0', tokens_total: '499000' }),
  ev('PriceUpdated', 60, { mint: A, price_e6: '20000000', twap_e6: '20000000' }),
  ev('PriceUpdated', 60, { mint: X, price_e6: '20000000', twap_e6: '20000000' }),
  // vault $299.40, supply 1.497 → U = 200; commission 20% × 100 × 1.497 = $29.94
  ev('CommissionSettled', 90, { bucket: B, vault_value_e6: '299400000', supply_before: '1497000', unit_price_before_e6: '200000000', hwm_before_e6: '100000000', commission_e6: '29940000', creator_tokens: '133067', platform_tokens: '33266', hwm_after_e6: '180000000' }),
  ev('Redeemed', 120, { order: 'R1', bucket: B, holder: BACKER, tokens_burned: '249500', fee_tokens: '0', unit_price_e6: '180000000', legs: [{ mint: A, amount: '1684125' }, { mint: X, amount: '561375' }], supply: '1413833', settled: false }),
  ev('RedeemFilled', 121, { order: 'R1', bucket: B, holder: BACKER, leg: 0, mint: A, qty_sold: '1684125', usdc_out: '33600000', vault_balance: '9543375' }),
  ev('RedeemFilled', 121, { order: 'R1', bucket: B, holder: BACKER, leg: 1, mint: X, qty_sold: '561375', usdc_out: '11200000', vault_balance: '3181125' }),
  ev('RedeemClosed', 122, { order: 'R1', bucket: B, holder: BACKER, usdc_out_total: '44800000' }),
  ev('EditProposed', 200, { bucket: B, version: 2, holdings: [{ mint: A, weight_bps: 5000 }, { mint: X, weight_bps: 2500 }, { mint: 'MintY111111111111111111111111111111111111111', weight_bps: 2500 }], note: 'Adding Y', effective_at: String(Math.floor((T0 + 200 * 60_000) / 1000) + 86_400), forced: false }),
  ev('BucketInfoUpdated', 210, { bucket: B, name: 'Renamed Bucket', thesis: 'new thesis' }),
  ev('FeesClaimed', 220, { bucket: B, recipient: CREATOR, creator: true, tokens: '133067' }),
];

let db: Db;
const snapshot = async () => {
  const tables = ['buckets', 'bucket_versions', 'holdings', 'vault_balances', 'positions', 'mint_orders', 'redeem_orders', 'commission_settlements', 'supply_log'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await db.query(`SELECT * FROM ${t} ORDER BY 1, 2`)).rows;
  return out;
};

beforeAll(async () => {
  db = await freshDb();
  await ingestEvents(db, events, { platformWallet: PLATFORM, nowMs: T0 + 300 * 60_000 });
});
afterAll(() => db.end());

describe('event projection', () => {
  it('builds the bucket, versions, pending edit and allow-list', async () => {
    const b = (await db.query('SELECT * FROM buckets')).rows[0];
    expect(b).toMatchObject({ name: 'Renamed Bucket', thesis: 'new thesis', status: 'open', version: 1, supply: '1413833', hwm_e6: '180000000', creator_funded: true, event_count: 17 });
    const versions = (await db.query('SELECT version, activated_at IS NOT NULL AS active, note FROM bucket_versions ORDER BY version')).rows;
    expect(versions).toEqual([{ version: 1, active: true, note: null }, { version: 2, active: false, note: 'Adding Y' }]);
    const slug = (await db.query('SELECT slug FROM bucket_slugs WHERE bucket = $1', [B])).rows[0];
    expect(slug.slug).toBe('test-bucket'); // assigned at creation, kept through the rename
    const listed = (await db.query('SELECT ticker, source, asset_type FROM assets WHERE program_listed ORDER BY ticker')).rows;
    expect(listed).toEqual([{ ticker: 'AAAx', source: 'xStocks', asset_type: 'public_stock' }, { ticker: 'pXXX', source: 'PreStocks', asset_type: 'pre_ipo' }]);
  });

  it('tracks vault balances net of reservations and closes orders', async () => {
    const v = (await db.query('SELECT mint, balance, reserved FROM vault_balances ORDER BY mint')).rows;
    expect(v).toEqual([{ mint: A, balance: '9543375', reserved: '0' }, { mint: X, balance: '3181125', reserved: '0' }]);
    expect((await db.query('SELECT status, rent_fee_e6 FROM mint_orders ORDER BY address')).rows).toEqual([
      { status: 'done', rent_fee_e6: '240000' },
      { status: 'done', rent_fee_e6: '0' },
    ]);
    expect((await db.query('SELECT status, usdc_out_e6 FROM redeem_orders')).rows).toEqual([{ status: 'done', usdc_out_e6: '44800000' }]);
  });

  it('keeps average-cost positions, commission tokens and dilution per wallet', async () => {
    const p = Object.fromEntries((await db.query('SELECT * FROM positions')).rows.map((r) => [r.wallet, r]));
    // Creator paid $100 + $0.24 rent for 0.998 tokens and received 0.133067 commission tokens at the post-fee unit price ($180.000036).
    expect(p[CREATOR]).toMatchObject({ tokens: '1131067', cost_e6: '100240000', commission_earned_e6: '23952064' });
    // Backer paid $50 for 0.499, redeemed half: cost $25, realized $44.80 − $25 = $19.80.
    expect(p[BACKER]).toMatchObject({ tokens: '249500', cost_e6: '25000000', realized_e6: '19800000', received_total_e6: '44800000' });
    // Both were diluted by the settlement: 0.499 × (200 − 180.000036) = $9.979982.
    expect(p[BACKER].commission_paid_e6).toBe('9979982');
    expect(p[PLATFORM]).toMatchObject({ tokens: '33266' });
  });

  it('notifies current holders of the proposed edit', async () => {
    const n = (await db.query(`SELECT wallet, kind, title FROM notifications ORDER BY wallet`)).rows;
    expect(n.map((r) => r.wallet).sort()).toEqual([BACKER, CREATOR].sort());
    expect(n[0].title).toBe('Test Bucket: edit proposed');
  });

  it('is idempotent and fully rebuildable from events', async () => {
    expect(await ingestEvents(db, events, { platformWallet: PLATFORM, nowMs: T0 })).toBe(0);
    const before = await snapshot();
    await rebuild(db, new Date(T0 + 300 * 60_000));
    expect(await snapshot()).toEqual(before);
  });
});

describe('creator funding', () => {
  it('opens a bucket to backers only after a creator order fills every leg', async () => {
    const B2 = 'Bkt2222222222222222222222222222222222222222';
    const base = [
      ev('BucketCreated', 400, { bucket: B2, creator: CREATOR, id: 1, token_mint: 'BktMint2222222222222222222222222222222222222', name: 'Second', thesis: '', holdings: [{ mint: A, weight_bps: 5000 }, { mint: X, weight_bps: 5000 }] }),
      ev('MintOpened', 401, { order: 'O9', bucket: B2, backer: CREATOR, amount_e6: '30000000', fee_e6: '60000', net_e6: '29940000', rent_fee_e6: '0', unit_price_e6: '100000000', legs: [{ mint: A, amount: '14970000' }, { mint: X, amount: '14970000' }] }),
      ev('MintFilled', 401, { order: 'O9', bucket: B2, backer: CREATOR, leg: 0, mint: A, usdc_spent: '14970000', qty: '748500', tokens: '149700', vault_balance: '748500', supply: '149700' }),
    ];
    await ingestEvents(db, base, { platformWallet: PLATFORM, nowMs: T0 });
    const funded = async () => (await db.query('SELECT creator_funded FROM buckets WHERE address = $1', [B2])).rows[0].creator_funded;
    expect(await funded()).toBe(false);
    await ingestEvents(db, [ev('MintFilled', 402, { order: 'O9', bucket: B2, backer: CREATOR, leg: 1, mint: X, usdc_spent: '14970000', qty: '748500', tokens: '149700', vault_balance: '748500', supply: '299400' })], { platformWallet: PLATFORM, nowMs: T0 });
    expect(await funded()).toBe(true);
  });
});
