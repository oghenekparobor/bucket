import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AlertSink } from '../src/alerts.js';
import { ChainUnavailableError } from '../src/chain/gateway.js';
import type { Db } from '../src/db/pool.js';
import { Keeper, MAX_LEG_ATTEMPTS } from '../src/keeper/keeper.js';
import { logger } from '../src/logger.js';
import { HOUR_MS } from '../src/util/time.js';
import { freshDb } from './helpers/db.js';
import { FakeGateway } from './helpers/fakeGateway.js';

let db: Db;
let gateway: FakeGateway;
let alerts: { level: string; code: string; key: string }[];
const sink: AlertSink = { raise: async (level, code, key) => void alerts.push({ level, code, key }) };
const keeper = () =>
  new Keeper({ db, gateway, alerts: sink, log: logger, cfg: { KEEPER_REBALANCE: false, KEEPER_MIN_SOL: 2, FEE_PAYER_MIN_SOL: 1 }, wallets: { keeper: 'K', feePayer: 'F' }, rand: () => 0 });

beforeAll(async () => {
  db = await freshDb();
});
afterAll(() => db.end());
beforeEach(() => {
  gateway = new FakeGateway();
  alerts = [];
});

describe('keeper', () => {
  it('fills every undone mint and redeem leg, then closes both orders', async () => {
    gateway.openOrders = [
      { kind: 'mint', address: 'M1', bucket: 'B1', owner: 'W', legs: [{ leg: 0, done: true }, { leg: 1, done: false }, { leg: 2, done: false }], expired: false },
      { kind: 'redeem', address: 'R1', bucket: 'B1', owner: 'W', legs: [{ leg: 0, done: false }, { leg: 1, done: false }], expired: false },
    ];
    const r = await keeper().tick();
    expect(r).toMatchObject({ mintLegs: 2, redeemLegs: 2, closed: 2, errors: 0 });
    expect(gateway.calls.map((c) => c.method)).toEqual([
      'fetchOpenOrders',
      'fillMintLeg',
      'fillMintLeg',
      'closeMintOrder',
      'fillRedeemLeg',
      'fillRedeemLeg',
      'closeRedeemOrder',
    ]);
  });

  it(`alerts and refunds a mint order after ${MAX_LEG_ATTEMPTS} failed fills`, async () => {
    gateway.openOrders = [{ kind: 'mint', address: 'M2', bucket: 'B1', owner: 'W', legs: [{ leg: 0, done: false }], expired: false }];
    gateway.failing.add('fillMintLeg');
    const k = keeper();
    for (let i = 0; i < MAX_LEG_ATTEMPTS; i++) await k.tick();
    expect(alerts).toEqual([{ level: 'error', code: 'fill_failed', key: 'M2:0' }]);
    expect(gateway.calls.filter((c) => c.method === 'closeMintOrder')).toHaveLength(1);
    expect(gateway.calls.filter((c) => c.method === 'fillMintLeg')).toHaveLength(MAX_LEG_ATTEMPTS);
  });

  it('closes an expired mint order without filling it', async () => {
    gateway.openOrders = [{ kind: 'mint', address: 'M3', bucket: 'B1', owner: 'W', legs: [{ leg: 0, done: false }], expired: true }];
    await keeper().tick();
    expect(gateway.calls.map((c) => c.method)).toEqual(['fetchOpenOrders', 'closeMintOrder']);
  });

  it('logs a missing key once instead of alerting', async () => {
    gateway.fetchOpenOrders = async () => {
      throw new ChainUnavailableError('No keeper keypair configured');
    };
    const r = await keeper().tick();
    expect(r.unavailable).toEqual(['fetch_orders']);
    expect(alerts).toEqual([]);
  });

  it('settles a bucket when due and schedules the next settlement 12–24h later', async () => {
    const now = new Date('2026-09-21T12:00:00Z');
    await db.query(
      `INSERT INTO buckets (address, creator, bucket_id, token_mint, name, thesis, supply, created_at) VALUES ('B9', 'C', 0, 'TM', 'n', 't', 1000000, $1)`,
      [new Date(now.getTime() - 48 * HOUR_MS)],
    );
    await db.query(`INSERT INTO keeper_schedule (bucket, next_settle_at) VALUES ('B9', $1)`, [new Date(now.getTime() - 1000)]);
    const r = await keeper().tick(now);
    expect(r.settled).toBe(1);
    const next = (await db.query(`SELECT next_settle_at FROM keeper_schedule WHERE bucket = 'B9'`)).rows[0].next_settle_at as Date;
    expect(next.getTime() - now.getTime()).toBe(12 * HOUR_MS);
  });

  it('alerts when a settlement fails and warns on low SOL balances', async () => {
    const now = new Date('2026-09-22T12:00:00Z');
    await db.query(`UPDATE keeper_schedule SET next_settle_at = $1 WHERE bucket = 'B9'`, [new Date(now.getTime() - 1000)]);
    gateway.failing.add('settle');
    const k = keeper();
    await k.tick(now);
    expect(alerts).toContainEqual({ level: 'error', code: 'settle_failed', key: 'B9' });
    await k.checkBalances(); // fake balance 1.5 SOL: keeper minimum 2 → warn; fee payer minimum 1 → fine
    expect(alerts).toContainEqual({ level: 'warn', code: 'low_balance', key: 'K' });
    expect(alerts.find((a) => a.key === 'F')).toBeUndefined();
  });
});

describe('keeper ordering', () => {
  it('fills a creator’s publish order before other orders while the bucket awaits funding', async () => {
    await db.query(
      `INSERT INTO buckets (address, creator, bucket_id, token_mint, name, thesis, created_at, creator_funded) VALUES ('NEW', 'CREATOR', 1, 'TM2', 'n', 't', now(), false)`,
    );
    gateway.openOrders = [
      { kind: 'mint', address: 'OTHER', bucket: 'B9', owner: 'SOMEONE', legs: [{ leg: 0, done: false }], expired: false },
      { kind: 'mint', address: 'PUBLISH', bucket: 'NEW', owner: 'CREATOR', legs: [{ leg: 0, done: false }], expired: false },
    ];
    await keeper().tick();
    const fills = gateway.calls.filter((c) => c.method === 'fillMintLeg').map((c) => (c.args as { order: string }).order);
    expect(fills).toEqual(['PUBLISH', 'OTHER']);
  });
});
