// The admin routes run worker jobs from the API process. They write to the database and one of
// them signs transactions, so the guard matters as much as the feature: off without a token,
// closed to a wrong one, and every run recorded like the worker's own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.js';
import type { AuthUser, Authenticator } from '../src/api/auth.js';
import type { ChainGateway } from '../src/chain/gateway.js';
import { config } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import { freshDb } from './helpers/db.js';

const TOKEN = 'admin-test-token';
let db: Db;
let app: FastifyInstance;

const build = (adminToken: string | undefined) =>
  buildApp({
    db,
    gateway: {} as ChainGateway,
    auth: { authenticate: async () => ({}) as AuthUser } as Authenticator,
    cfg: { ...config, ADMIN_TOKEN: adminToken },
  });

const call = (method: 'GET' | 'POST', url: string, token?: string) =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  db = await freshDb();
  app = await build(TOKEN);
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('admin job routes', () => {
  it('are off until ADMIN_TOKEN is set', async () => {
    const off = await build(undefined);
    const res = await off.inject({ method: 'POST', url: '/v1/admin/jobs/privy-webhook-prune', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(503);
    await off.close();
  });

  it('refuse a missing or wrong token', async () => {
    expect((await call('POST', '/v1/admin/jobs/privy-webhook-prune')).statusCode).toBe(401);
    expect((await call('POST', '/v1/admin/jobs/privy-webhook-prune', 'nope')).statusCode).toBe(401);
    expect((await call('GET', '/v1/admin/jobs', `${TOKEN}x`)).statusCode).toBe(401); // length differs
  });

  it('404 an unknown job rather than guessing', async () => {
    const res = await call('POST', '/v1/admin/jobs/reboot-everything', TOKEN);
    expect(res.statusCode).toBe(404);
  });

  it('run a job, return its result and record the run like the worker does', async () => {
    const res = await call('POST', '/v1/admin/jobs/privy-webhook-prune', TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ job: 'privy-webhook-prune', ok: true, result: { deleted: 0 } });
    const runs = await db.query(`SELECT ok FROM job_runs WHERE job = 'privy-webhook-prune'`);
    expect(runs.rows).toEqual([{ ok: true }]);
  });

  it('list every job the worker knows, with the last run where there is one', async () => {
    const res = await call('GET', '/v1/admin/jobs', TOKEN);
    expect(res.statusCode).toBe(200);
    const jobs: { name: string; lastRun: { ok: boolean } | null }[] = res.json().jobs;
    const names = jobs.map((j) => j.name);
    for (const expected of ['catalog', 'indexer', 'prices', 'token-metadata']) expect(names).toContain(expected);
    expect(jobs.find((j) => j.name === 'privy-webhook-prune')?.lastRun).toMatchObject({ ok: true });
    expect(jobs.find((j) => j.name === 'catalog')?.lastRun).toBeNull();
  });
});
