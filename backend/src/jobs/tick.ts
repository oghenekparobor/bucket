/**
 * Cron mode: run every job that is due, once, in the worker's order. A scheduler that calls this
 * every minute reproduces the worker without a long-running process. "Due" means the job never
 * succeeded here, or its last success is older than its interval — read from job_runs, which the
 * runner writes for every attempt.
 */
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import { JOBS, runJobByName } from './registry.js';
import { SCHEDULE, type ScheduledJob } from './schedule.js';

export interface TickOptions {
  /** Run every job, due or not. */
  force?: boolean;
  /** Consider only these jobs. */
  only?: string[];
  now?: Date;
}

export interface JobOutcome {
  name: string;
  ok: boolean;
  ms: number;
  result?: unknown;
  error?: string;
}

export interface DueReport {
  ran: JobOutcome[];
  /** Jobs considered but not due. */
  skipped: string[];
}

/** Job results may carry bigints, which neither JSON nor pino can carry. */
export const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

/** Pure: which of `schedule` is due at `now`, given each job's last successful finish. */
export function dueJobs(schedule: ScheduledJob[], lastOk: Map<string, Date>, now: Date, opts: TickOptions = {}): ScheduledJob[] {
  return schedule.filter((j) => {
    if (opts.only && !opts.only.includes(j.name)) return false;
    if (opts.force) return true;
    const last = lastOk.get(j.name);
    return !last || now.getTime() - last.getTime() >= j.everyMs;
  });
}

export async function runDueJobs(db: Db, opts: TickOptions = {}): Promise<DueReport> {
  const now = opts.now ?? new Date();
  const r = await db.query<{ job: string; at: Date }>(`SELECT job, max(finished_at) AS at FROM job_runs WHERE ok GROUP BY job`);
  const lastOk = new Map(r.rows.map((x) => [x.job, x.at]));
  const known = SCHEDULE.filter((j) => JOBS[j.name]);
  const due = dueJobs(known, lastOk, now, opts);
  const ran: JobOutcome[] = [];
  for (const j of due) {
    const t0 = Date.now();
    try {
      // Recorded in job_runs by the runner, so the next tick sees it as done.
      const result = jsonSafe(await runJobByName(db, j.name));
      ran.push({ name: j.name, ok: true, ms: Date.now() - t0, result });
    } catch (err) {
      // One failing job must not stop the others; the runner has recorded the error already.
      ran.push({ name: j.name, ok: false, ms: Date.now() - t0, error: (err as Error).message });
      logger.warn({ component: 'tick', job: j.name, err: (err as Error).message }, 'job failed');
    }
  }
  const ranNames = new Set(ran.map((x) => x.name));
  const considered = opts.only ? known.filter((j) => opts.only!.includes(j.name)) : known;
  return { ran, skipped: considered.filter((j) => !ranNames.has(j.name)).map((j) => j.name) };
}
