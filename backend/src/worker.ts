/**
 * Background worker: `pnpm --filter @bucket/backend worker`. Runs the chain indexer, catalog, price,
 * price-push, performance, leaderboard, pool-monitor and notification loops on fixed intervals, never
 * overlapping a job with itself.
 */
import { Alerter } from './alerts.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createIndexer, JOBS, runJobByName } from './jobs/registry.js';
import { SCHEDULE } from './jobs/schedule.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'worker' });
const db = createPool();
await migrate(db);
const alerts = new Alerter(db, log, config.ALERT_WEBHOOK_URL);

interface Scheduled {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  /** Record in job_runs and alert on failure (off for the chatty sub-minute loops). */
  tracked: boolean;
}

const indexer = createIndexer(db);

// The indexer is a live object here (it keeps its RPC connection); everything else runs through the
// registry. Untracked loops skip job_runs because they fire every few seconds.
const schedule: Scheduled[] = SCHEDULE.map((j) => ({
  ...j,
  run: j.name === 'indexer' ? () => indexer.pollOnce() : j.tracked ? () => runJobByName(db, j.name) : () => JOBS[j.name]!(db),
}));

const timers: NodeJS.Timeout[] = [];
for (const job of schedule) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await job.run();
      if (job.tracked) log.info({ job: job.name, result }, 'job finished');
    } catch (err) {
      log.error({ job: job.name, err: (err as Error).message }, 'job failed');
      await alerts.raise('error', 'job_failed', job.name, `${job.name} job failed`, { error: (err as Error).message }).catch(() => undefined);
    } finally {
      busy = false;
    }
  };
  void tick();
  timers.push(setInterval(tick, job.everyMs));
}
log.info({ jobs: schedule.map((j) => j.name), cluster: config.CLUSTER, programId: config.PROGRAM_ID }, 'worker started');

const stop = async () => {
  for (const t of timers) clearInterval(t);
  await db.end();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
