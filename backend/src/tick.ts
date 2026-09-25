/**
 * One-shot maintenance pass for a scheduler (Railway cron, GitHub Actions, crontab): run every job
 * that is due, optionally one keeper pass, print the report, exit.
 *
 *   node dist/src/tick.js            jobs that are due (indexer, catalog, prices, ...)
 *   node dist/src/tick.js --keeper   plus one keeper pass; needs KEEPER_KEYPAIR and FEE_PAYER_KEYPAIR
 *   node dist/src/tick.js --force    every job, due or not
 *
 * Exit status is 1 if any job failed, so the scheduler can show it.
 */
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { jsonSafe, runDueJobs } from './jobs/tick.js';
import { runKeeperOnce } from './keeper/once.js';
import { logger } from './logger.js';

const args = new Set(process.argv.slice(2));
const db = createPool();
await migrate(db, (m) => logger.info(m));
const jobs = await runDueJobs(db, { force: args.has('--force') });
const keeper = args.has('--keeper') ? await runKeeperOnce(db) : undefined;
logger.info({ component: 'tick', ...jobs, keeper: jsonSafe(keeper) }, 'tick finished');
await db.end();
process.exit(jobs.ran.some((r) => !r.ok) ? 1 : 0);
