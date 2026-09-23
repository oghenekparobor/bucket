import { type Db, withTx } from '../db/pool.js';
import { chunk } from '../util/concurrency.js';
import type { RawEvent } from './events.js';
import { applyEvent, type ProjectionContext } from './projection.js';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/**
 * Stores events (idempotent on signature + event index) and projects each newly stored one, in order.
 * Returns how many were new.
 */
export async function ingestEvents(db: Db, events: RawEvent[], ctx: ProjectionContext, batchSize = 500): Promise<number> {
  let inserted = 0;
  for (const batch of chunk(events, batchSize)) {
    inserted += await withTx(db, async (c) => {
      let n = 0;
      for (const ev of batch) {
        const bucket = typeof ev.data.bucket === 'string' ? ev.data.bucket : null;
        const r = await c.query<{ id: string }>(
          `INSERT INTO events (signature, slot, event_index, block_time, name, bucket, data, fixture)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (signature, event_index) DO NOTHING RETURNING id`,
          [ev.signature, ev.slot, ev.eventIndex, ev.blockTime, ev.name, bucket, json(ev.data), ev.fixture ?? false],
        );
        const id = r.rows[0]?.id;
        if (!id) continue;
        await applyEvent(c, { ...ev, id: Number(id) }, ctx);
        n++;
      }
      return n;
    });
  }
  return inserted;
}

/** Re-projects every stored event in chain order (used by rebuild after derived tables are cleared). */
export async function replayEvents(db: Db, ctx: ProjectionContext, pageSize = 2000): Promise<number> {
  let lastSlot = -1;
  let lastId = 0;
  let total = 0;
  for (;;) {
    const page = await db.query(
      `SELECT id, signature, slot, event_index, block_time, name, data, fixture FROM events
       WHERE (slot, id) > ($1, $2) ORDER BY slot, id LIMIT $3`,
      [lastSlot, lastId, pageSize],
    );
    if (page.rows.length === 0) return total;
    await withTx(db, async (c) => {
      for (const row of page.rows) {
        await applyEvent(
          c,
          {
            id: Number(row.id),
            signature: row.signature,
            slot: Number(row.slot),
            eventIndex: row.event_index,
            blockTime: row.block_time,
            name: row.name,
            data: row.data,
            fixture: row.fixture,
          },
          ctx,
        );
      }
    });
    const last = page.rows.at(-1)!;
    lastSlot = Number(last.slot);
    lastId = Number(last.id);
    total += page.rows.length;
  }
}
