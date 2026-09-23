// The live indexer checkpoints by signature and asks RPC for everything `until` that signature. A
// public cluster answers from a pool of nodes, and one that never saw the checkpoint (or has pruned
// it) fails the whole call with "Transaction not found" — which stalled indexing until a request
// happened to land on a node that knew it. Devnet did exactly this on 2026-09-23.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '@solana/web3.js';
import type { Db } from '../src/db/pool.js';
import type { EventName } from '../src/indexer/events.js';
import { ChainIndexer } from '../src/indexer/poller.js';
import { logger } from '../src/logger.js';
import { freshDb } from './helpers/db.js';

const PROGRAM = 'GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29';
const PLATFORM = 'E9D5dRD7PQDvEDTgqRLsK1V6yquTfbCSgabAUCVmdYwi';
const MINT = 'MintA111111111111111111111111111111111111111';

/** One signature per slot; the log line carries the asset the fake decoder should emit. */
const chain = [
  { signature: 'sig-a', slot: 100, err: null },
  { signature: 'sig-b', slot: 101, err: null },
  { signature: 'sig-c', slot: 102, err: null },
];

interface Calls {
  withUntil: number;
  withoutUntil: number;
}

/** A Connection that only knows the checkpoint signature when `knowsCheckpoint` says so. */
function fakeConnection(knowsCheckpoint: boolean, calls: Calls): Connection {
  return {
    async getSignaturesForAddress(_program: unknown, opts: { until?: string; before?: string }) {
      if (opts.until) {
        calls.withUntil++;
        if (!knowsCheckpoint) throw new Error(`failed to get signatures for address: Transaction ${opts.until} not found`);
        const from = chain.findIndex((s) => s.signature === opts.until);
        return chain.slice(0, from === -1 ? chain.length : from).reverse();
      }
      calls.withoutUntil++;
      return [...chain].reverse(); // newest first, whole history
    },
    async getTransaction(signature: string) {
      const slot = chain.find((s) => s.signature === signature)?.slot ?? 0;
      return { meta: { logMessages: [`asset ${slot}`] }, blockTime: 1_790_000_000 };
    },
  } as unknown as Connection;
}

/** Turns each fake log line into one AssetAdded event, so ingestion is observable in `events`. */
const decode = (logs: string[]) =>
  logs.map((line) => ({
    name: 'AssetAdded' as EventName,
    data: {
      mint: `${MINT.slice(0, 40)}${line.split(' ')[1]}`,
      source: 'xStocks',
      asset_type: 'publicStock',
      symbol: 'AAAx',
      decimals: 6,
      token_program: 'Tokenz',
      price_e6: '10000000',
    },
  }));

const indexer = (conn: Connection, db: Db) =>
  new ChainIndexer(db, conn, PROGRAM, decode, () => ({ platformWallet: PLATFORM, nowMs: Date.now() }), logger);

const checkpoint = (db: Db) =>
  db.query<{ last_signature: string; last_slot: string }>("SELECT last_signature, last_slot FROM indexer_state WHERE key = 'program'");
const eventCount = async (db: Db) => Number((await db.query('SELECT count(*) FROM events')).rows[0].count);

let db: Db;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.end();
});

describe('ChainIndexer checkpoint recovery', () => {
  it('indexes from scratch and checkpoints the newest signature', async () => {
    const calls: Calls = { withUntil: 0, withoutUntil: 0 };
    expect(await indexer(fakeConnection(true, calls), db).pollOnce()).toBe(3);
    expect((await checkpoint(db)).rows[0]).toMatchObject({ last_signature: 'sig-c', last_slot: '102' });
  });

  it('makes progress when the RPC node does not know the checkpoint signature', async () => {
    // A new transaction lands, but this node has never heard of the checkpoint.
    chain.push({ signature: 'sig-d', slot: 103, err: null });
    const calls: Calls = { withUntil: 0, withoutUntil: 0 };
    const indexed = await indexer(fakeConnection(false, calls), db).pollOnce();

    expect(calls.withUntil).toBeGreaterThan(0); // tried the checkpoint first
    expect(calls.withoutUntil).toBeGreaterThan(0); // then paged by slot instead of giving up
    expect(indexed).toBe(1); // only the new event; the re-read ones are deduped by (signature, event_index)
    expect(await eventCount(db)).toBe(4);
    expect((await checkpoint(db)).rows[0]).toMatchObject({ last_signature: 'sig-d', last_slot: '103' });
  });

  it('surfaces errors that are not a missing checkpoint', async () => {
    const conn = {
      async getSignaturesForAddress() {
        throw new Error('429 Too Many Requests');
      },
    } as unknown as Connection;
    await expect(indexer(conn, db).pollOnce()).rejects.toThrow(/429/);
  });
});
