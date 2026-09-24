/**
 * Live indexer: pulls new program transactions from RPC, decodes their logs and ingests the events.
 * Progress is checkpointed by signature in `indexer_state`.
 */
import { type Connection, PublicKey } from '@solana/web3.js';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';
import type { DecodeEvents } from './decode.js';
import type { RawEvent } from './events.js';
import { ingestEvents } from './ingest.js';
import type { ProjectionContext } from './projection.js';

const STATE_KEY = 'program';
const PAGE = 1000;

export class ChainIndexer {
  constructor(
    private readonly db: Db,
    private readonly connection: Connection,
    private readonly programId: string,
    private readonly decode: DecodeEvents,
    private readonly ctx: () => ProjectionContext,
    private readonly log: Logger,
    /** Called with the buckets whose events were just ingested (refreshes their metrics right away). */
    private readonly onBucketsChanged: (buckets: string[]) => Promise<void> = async () => undefined,
    /**
     * Called when an asset was listed or changed on chain. A newly listed mint is created with
     * `eligible = false` and no reason, and would sit like that until the next scheduled price
     * sync — on a fresh deployment that read as "every token is below the floor".
     */
    private readonly onAssetsChanged: () => Promise<void> = async () => undefined,
  ) {}

  /** Indexes everything since the checkpoint; returns the number of new events. */
  async pollOnce(): Promise<number> {
    const state = await this.db.query<{ last_signature: string | null; last_slot: string | null }>(
      'SELECT last_signature, last_slot FROM indexer_state WHERE key = $1',
      [STATE_KEY],
    );
    const until = state.rows[0]?.last_signature ?? undefined;
    const lastSlot = state.rows[0]?.last_slot != null ? Number(state.rows[0].last_slot) : null;
    const program = new PublicKey(this.programId);

    /**
     * A public cluster answers as a pool of nodes, and one that never saw the checkpoint signature (or
     * has pruned it) rejects `until` with "Transaction not found" — which used to stall indexing until
     * the request happened to land on a node that knew it. Fall back to paging by slot: re-reading a
     * slot is harmless because events are keyed by (signature, event_index).
     */
    let bySlot = false;
    const fetchPage = async (before: string | undefined) => {
      if (until && !bySlot) {
        try {
          return await this.connection.getSignaturesForAddress(program, { until, before, limit: PAGE }, 'confirmed');
        } catch (err) {
          if (!/not found/i.test((err as Error).message)) throw err;
          bySlot = true;
          this.log.warn({ until, lastSlot }, 'RPC does not know the checkpoint signature; paging by slot');
        }
      }
      return this.connection.getSignaturesForAddress(program, { before, limit: PAGE }, 'confirmed');
    };

    // Newest-first pages back to the checkpoint, then process oldest-first.
    const sigs: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await fetchPage(before);
      sigs.push(...page);
      const oldest = page.at(-1);
      if (!oldest || page.length < PAGE) break;
      if (bySlot && lastSlot !== null && oldest.slot <= lastSlot) break;
      before = oldest.signature;
    }
    // Paging by slot has no checkpoint bound, so drop what the checkpoint already covers.
    const fresh = bySlot && lastSlot !== null ? sigs.filter((s) => s.slot >= lastSlot) : sigs;
    if (fresh.length === 0) return 0;
    fresh.reverse();

    let total = 0;
    const touched = new Set<string>();
    let assetsChanged = false;
    for (const s of fresh) {
      if (!s.err) {
        const tx = await this.connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        const logs = tx?.meta?.logMessages ?? [];
        const blockTime = new Date((tx?.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
        const events: RawEvent[] = this.decode(logs).map((e, i) => ({ ...e, signature: s.signature, slot: s.slot, eventIndex: i, blockTime }));
        if (events.length) total += await ingestEvents(this.db, events, this.ctx());
        for (const e of events) {
          if (typeof e.data.bucket === 'string') touched.add(e.data.bucket);
          if (e.name === 'AssetAdded' || e.name === 'AssetUpdated') assetsChanged = true;
        }
      }
      await this.db.query(
        `INSERT INTO indexer_state (key, last_signature, last_slot, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET last_signature = EXCLUDED.last_signature, last_slot = EXCLUDED.last_slot, updated_at = now()`,
        [STATE_KEY, s.signature, s.slot],
      );
    }
    if (total) this.log.info({ events: total, txs: fresh.length }, 'indexed program events');
    if (assetsChanged) await this.onAssetsChanged();
    if (touched.size) await this.onBucketsChanged([...touched]);
    return total;
  }
}
