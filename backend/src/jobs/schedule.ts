/**
 * How often each background job runs. One table for the long-running worker and for cron mode
 * (`runDueJobs`), so a deployment driven by a scheduler runs exactly what the worker would.
 */
import { HOUR_MS } from '../util/time.js';

export interface ScheduledJob {
  name: string;
  everyMs: number;
  /** Record in job_runs and alert on failure (off in the worker for the chatty sub-minute loops). */
  tracked: boolean;
}

export const SCHEDULE: ScheduledJob[] = [
  { name: 'indexer', everyMs: 3_000, tracked: false },
  { name: 'catalog', everyMs: HOUR_MS, tracked: true },
  { name: 'prices', everyMs: 5 * 60_000, tracked: true },
  { name: 'price-push', everyMs: 3 * 60_000, tracked: true },
  { name: 'performance', everyMs: 10 * 60_000, tracked: true },
  { name: 'leaderboard', everyMs: HOUR_MS, tracked: true },
  { name: 'pool-monitor', everyMs: 5 * 60_000, tracked: true },
  { name: 'routing-probe', everyMs: 24 * HOUR_MS, tracked: true },
  { name: 'deadline-alerts', everyMs: 24 * HOUR_MS, tracked: true },
  { name: 'privy-webhook-prune', everyMs: 24 * HOUR_MS, tracked: true },
  { name: 'notifications', everyMs: 30_000, tracked: false },
];
