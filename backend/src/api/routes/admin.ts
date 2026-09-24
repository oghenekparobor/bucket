/**
 * Run a worker job now, from the API process.
 *
 *   GET  /v1/admin/jobs         every job the worker knows, with its last run
 *   POST /v1/admin/jobs/:name   run one and return its result
 *
 * The worker is a separate service and the app is empty until it has run. This is the lever for
 * kicking the catalog or the indexer by hand, and for re-running a job after fixing whatever it
 * needed. Every job writes to the database and `price-push` signs transactions, so the routes are
 * off until ADMIN_TOKEN is set and answer only to that bearer token.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JOBS, runJobByName } from '../../jobs/registry.js';
import type { AppContext } from '../app.js';
import { HttpError, notFound, parse, unauthorized } from '../errors.js';

function requireAdmin(req: FastifyRequest, token: string | undefined): void {
  if (!token) throw new HttpError(503, 'not_configured', 'Admin routes are off until ADMIN_TOKEN is set');
  const header = req.headers.authorization;
  const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  // Constant-time, and never on buffers of different lengths (timingSafeEqual throws).
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized('Invalid admin token');
}

/** Job results may carry bigints, which JSON cannot; the runner stores them the same way. */
const jsonSafe = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const opts = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/v1/admin/jobs', opts, async (req) => {
    requireAdmin(req, ctx.cfg.ADMIN_TOKEN);
    const runs = await ctx.db.query<{ job: string; started_at: Date; finished_at: Date | null; ok: boolean | null; error: string | null }>(
      `SELECT DISTINCT ON (job) job, started_at, finished_at, ok, error FROM job_runs ORDER BY job, started_at DESC`,
    );
    const last = new Map(runs.rows.map((r) => [r.job, r]));
    return {
      jobs: Object.keys(JOBS).map((name) => {
        const r = last.get(name);
        return {
          name,
          lastRun: r
            ? { startedAt: r.started_at.toISOString(), finishedAt: r.finished_at?.toISOString() ?? null, ok: r.ok, error: r.error }
            : null,
        };
      }),
    };
  });

  app.post('/v1/admin/jobs/:name', opts, async (req) => {
    requireAdmin(req, ctx.cfg.ADMIN_TOKEN);
    const { name } = parse(z.object({ name: z.string().min(1).max(64) }), req.params);
    if (!JOBS[name]) throw notFound(`Job "${name}"`);
    const started = Date.now();
    try {
      const result = await runJobByName(ctx.db, name);
      req.log.info({ job: name, durationMs: Date.now() - started }, 'admin ran job');
      return { job: name, ok: true, durationMs: Date.now() - started, result: jsonSafe(result) };
    } catch (err) {
      // Recorded in job_runs by the runner already; surface the reason to whoever pressed the button.
      throw new HttpError(500, 'job_failed', `${name} failed: ${(err as Error).message}`);
    }
  });
}
