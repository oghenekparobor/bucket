import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AlertSink } from '../src/alerts.js';
import { recomputeEligibility } from '../src/catalog/repo.js';
import type { Db } from '../src/db/pool.js';
import { runDeadlineAlerts } from '../src/jobs/deadlineAlerts.js';
import { freshDb } from './helpers/db.js';

const PSPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh'; // listed in config/issuer-events.json
const MOCK = 'MockSpaceX111111111111111111111111111111111';
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  await db.query(
    `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, price_e6, liquidity_usd, source_payload) VALUES
       ($1, 'pSPACEX', 'SpaceX', 'PreStocks', 'pre_ipo', 9, 584000000, 900000, '{}'),
       ('Liquid111111111111111111111111111111111111', 'NVDAx', 'NVIDIA', 'xStocks', 'public_stock', 8, 227000000, 2000000, '{}'),
       ('Thin1111111111111111111111111111111111111111', 'KOx', 'Coca-Cola', 'xStocks', 'public_stock', 8, 89000000, 150000, '{}')`,
    [PSPACEX],
  );
  await db.query(
    `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, program_listed, program_enabled, mirror_of) VALUES ($1, 'pSPACEX', 'pSPACEX', 'PreStocks', 'pre_ipo', 9, true, true, $2)`,
    [MOCK, PSPACEX],
  );
  await recomputeEligibility(db, { floorUsd: 250_000, requireQuoteProbe: false, maxMinTradeUsd: 1 });
});
afterAll(() => db.end());

describe('issuer events and eligibility reasons', () => {
  it('marks a token with an issuer deadline ineligible, with the reason and deadline, also for its devnet mock', async () => {
    const rows = Object.fromEntries((await db.query('SELECT mint, eligible, eligibility_reason, deadline FROM assets')).rows.map((r) => [r.mint, r]));
    expect(rows[PSPACEX]).toMatchObject({ eligible: false, eligibility_reason: 'issuer_conversion_deadline' });
    expect((rows[PSPACEX].deadline as Date).toISOString()).toBe('2027-03-12T23:59:00.000Z');
    expect(rows[MOCK]).toMatchObject({ eligible: false, eligibility_reason: 'issuer_conversion_deadline' });
    expect(rows.Thin1111111111111111111111111111111111111111).toMatchObject({ eligible: false, eligibility_reason: 'below_liquidity_floor', deadline: null });
    expect(rows.Liquid111111111111111111111111111111111111).toMatchObject({ eligible: true, eligibility_reason: null });
  });

  it('alerts daily for buckets holding a token whose deadline is under 60 days away', async () => {
    await db.query(`INSERT INTO buckets (address, creator, bucket_id, token_mint, name, thesis, created_at) VALUES ('B1', 'C', 0, 'T', 'Space Bucket', '', now())`);
    await db.query(`INSERT INTO holdings (bucket, mint, weight_bps, position) VALUES ('B1', $1, 2500, 0)`, [MOCK]);
    const alerts: { level: string; code: string; key: string }[] = [];
    const sink: AlertSink = { raise: async (level, code, key) => void alerts.push({ level, code, key }) };
    expect(await runDeadlineAlerts(db, sink, new Date('2026-09-21T00:00:00Z'))).toEqual({ alerted: 0 });
    expect(await runDeadlineAlerts(db, sink, new Date('2027-02-01T00:00:00Z'))).toEqual({ alerted: 1 });
    expect(alerts).toEqual([{ level: 'warn', code: 'holding_deadline', key: 'B1:pSPACEX' }]);
    await runDeadlineAlerts(db, sink, new Date('2027-03-10T00:00:00Z'));
    expect(alerts.at(-1)!.level).toBe('error'); // a week or less left
  });
});
