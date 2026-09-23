/**
 * Rebuilds every derived table from `events` + `asset_prices`: truncates them, resets the on-chain
 * columns of `assets`, drops PriceUpdated-derived prices, replays all events in chain order, then
 * recomputes performance and the leaderboard. `pnpm --filter @bucket/backend rebuild`.
 */
import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db, withTx } from '../src/db/pool.js';
import { replayEvents } from '../src/indexer/ingest.js';
import { runLeaderboard } from '../src/jobs/leaderboard.js';
import { runPerformance } from '../src/jobs/performance.js';
import { pathToFileURL } from 'node:url';

export const DERIVED_TABLES = [
  'buckets',
  'bucket_versions',
  'holdings',
  'vault_balances',
  'vault_balance_log',
  'supply_log',
  'commission_settlements',
  'mint_orders',
  'mint_order_legs',
  'redeem_orders',
  'redeem_order_legs',
  'positions',
  'position_log',
  'unit_price_hourly',
  'bucket_metrics',
  'leaderboard_rows',
  'leaderboard_snapshots',
  'keeper_schedule',
];

export async function rebuild(db: Db, now = new Date()) {
  await withTx(db, async (c) => {
    await c.query(`TRUNCATE ${DERIVED_TABLES.join(', ')}`);
    await c.query(`DELETE FROM asset_prices WHERE kind = 'program'`);
    await c.query(`DELETE FROM kv WHERE key = 'program_config'`);
    // Mock mints known only from AssetAdded disappear; catalog rows just lose their on-chain state.
    await c.query(`DELETE FROM assets WHERE program_listed AND source_payload IS NULL AND NOT fixture`);
    await c.query(`UPDATE assets SET program_listed = false, program_enabled = NULL, program_flagged = NULL, extra_cost_bps = NULL, mirror_of = NULL`);
  });
  const events = await replayEvents(db, { platformWallet: config.PLATFORM_FEE_WALLET, nowMs: now.getTime() });
  const perf = await runPerformance(db, now);
  const board = await runLeaderboard(db, now);
  return { events, buckets: perf.buckets, eligible: board.eligible };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool();
  try {
    await migrate(db);
    const started = Date.now();
    const result = await rebuild(db);
    console.log(`rebuilt from ${result.events} events: ${result.buckets} buckets in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
