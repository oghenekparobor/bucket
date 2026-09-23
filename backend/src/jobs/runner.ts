import type { Queryable } from '../db/pool.js';

/** Runs a job and records it in `job_runs` (health reads the last successful catalog sync from here). */
export async function recordJob<T>(db: Queryable, job: string, fn: () => Promise<T>): Promise<T> {
  const started = new Date();
  const row = await db.query<{ id: string }>('INSERT INTO job_runs (job, started_at) VALUES ($1, $2) RETURNING id', [job, started]);
  const id = row.rows[0]!.id;
  try {
    const result = await fn();
    await db.query('UPDATE job_runs SET finished_at = now(), ok = true, stats = $2 WHERE id = $1', [
      id,
      JSON.stringify(result ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ]);
    return result;
  } catch (err) {
    await db.query('UPDATE job_runs SET finished_at = now(), ok = false, error = $2 WHERE id = $1', [id, (err as Error).message.slice(0, 1000)]);
    throw err;
  }
}
