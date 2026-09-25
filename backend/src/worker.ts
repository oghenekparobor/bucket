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
import { logger } from './logger.js';
import { HOUR_MS } from './util/time.js';

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

const tracked = (name: string, everyMs: number): Scheduled => ({ name, everyMs, run: () => runJobByName(db, name), tracked: true });
const schedule: Scheduled[] = [
  { name: 'indexer', everyMs: 3_000, run: () => indexer.pollOnce(), tracked: false },
  tracked('catalog', HOUR_MS),
  tracked('prices', 5 * 60_000),
  tracked('price-push', 3 * 60_000),
  tracked('performance', 10 * 60_000),
  tracked('leaderboard', HOUR_MS),
  tracked('pool-monitor', 5 * 60_000),
  tracked('routing-probe', 24 * HOUR_MS),
  tracked('deadline-alerts', 24 * HOUR_MS),
  tracked('privy-webhook-prune', 24 * HOUR_MS),
  { name: 'notifications', everyMs: 30_000, run: () => JOBS.notifications!(db), tracked: false },
];

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
