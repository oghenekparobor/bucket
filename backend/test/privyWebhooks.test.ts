import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.js';
import type { AuthUser, Authenticator } from '../src/api/auth.js';
import type { ChainGateway } from '../src/chain/gateway.js';
import { config } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import { applyPrivyWebhook } from '../src/privy/webhooks.js';
import { freshDb } from './helpers/db.js';

const PRIVY_ID = 'did:privy:abc123';
const WALLET = 'BvtnKpq9r1Vj5Hs6kzC4tGgw8Bq1TfE7YfXm3Zt2Aa9C';
const SECRET = 'whsec_test';

const privyUser = (over: Partial<{ email: string | null; twitter: string | null; wallet: string | null }> = {}) => ({
  id: PRIVY_ID,
  email: over.email === null ? null : { address: over.email ?? 'holder@example.com' },
  twitter: over.twitter === null ? null : { username: over.twitter ?? 'holderonchain' },
  linkedAccounts: [
    ...(over.wallet === null
      ? []
      : [{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: over.wallet ?? WALLET, latestVerifiedAt: new Date() }]),
  ],
});

let db: Db;
let app: FastifyInstance;
/** Accepts one signature value, like Privy's verifyWebhook accepts only a correctly signed body. */
const verifier = {
  verifyWebhook: async (payload: object, headers: { id: string; timestamp: string; signature: string }, secret: string) => {
    if (secret !== SECRET || headers.signature !== 'v1,good') throw new Error('bad signature');
    return payload;
  },
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/webhooks/privy',
    payload: body as object,
    headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1790000000', 'svix-signature': 'v1,good', ...headers },
  });

beforeAll(async () => {
  db = await freshDb();
  app = await buildApp({
    db,
    gateway: {} as ChainGateway,
    auth: { authenticate: async () => ({}) as AuthUser } as Authenticator,
    cfg: { ...config, PRIVY_WEBHOOK_SECRET: SECRET },
    privy: verifier,
  });
});
afterAll(async () => {
  await app.close();
  await db.end();
});

const user = () => db.query('SELECT privy_id, wallet, email, x_handle, x_verified, deleted_at FROM users WHERE wallet = $1 OR privy_id = $2', [WALLET, PRIVY_ID]);

describe('POST /v1/webhooks/privy', () => {
  it('refuses a body whose signature does not verify, and records nothing', async () => {
    const res = await post({ type: 'user.created', user: privyUser() }, { 'svix-signature': 'v1,forged' });
    expect(res.statusCode).toBe(401);
    expect((await db.query('SELECT count(*) FROM privy_webhook_events')).rows[0].count).toBe('0');
    expect((await user()).rowCount).toBe(0);
  });

  it('rejects a delivery with no signature headers', async () => {
    const res = await post({ type: 'user.created', user: privyUser() }, { 'svix-signature': '' });
    expect(res.statusCode).toBe(400);
  });

  it('syncs the wallet, email and X handle when an account is linked', async () => {
    const res = await post({ type: 'user.linked_account', user: privyUser() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, outcome: 'applied' });
    expect((await user()).rows[0]).toMatchObject({
      privy_id: PRIVY_ID,
      wallet: WALLET,
      email: 'holder@example.com',
      x_handle: 'holderonchain',
      x_verified: true,
    });
  });

  it('applies a retried delivery only once', async () => {
    const again = await post({ type: 'user.linked_account', user: privyUser({ twitter: 'changed' }) });
    expect(again.json()).toMatchObject({ outcome: 'duplicate' });
    expect((await user()).rows[0].x_handle).toBe('holderonchain');
  });

  it('drops the verified badge when X is unlinked, keeping the notification email', async () => {
    await db.query('UPDATE users SET email = $2 WHERE privy_id = $1', [PRIVY_ID, 'chosen@example.com']);
    const res = await post({ type: 'user.unlinked_account', user: privyUser({ twitter: null, email: null }) }, { 'svix-id': 'msg_2' });
    expect(res.statusCode).toBe(200);
    const row = (await user()).rows[0];
    expect(row).toMatchObject({ x_handle: null, x_verified: false });
    expect(row.email).toBe('chosen@example.com'); // an email set for notifications is not wiped by Privy
  });

  it('clears everything personal when the account is deleted, keeping the public wallet', async () => {
    const res = await post({ type: 'user.deleted', user: { id: PRIVY_ID, linkedAccounts: [] } }, { 'svix-id': 'msg_3' });
    expect(res.json()).toMatchObject({ outcome: 'deleted' });
    const row = (await user()).rows[0];
    expect(row).toMatchObject({ privy_id: null, email: null, x_handle: null, x_verified: false, wallet: WALLET });
    expect(row.deleted_at).not.toBeNull();
  });

  it('answers 503 when no webhook secret is configured', async () => {
    const other = await buildApp({ db, gateway: {} as ChainGateway, auth: { authenticate: async () => ({}) as AuthUser } as Authenticator, cfg: { ...config, PRIVY_WEBHOOK_SECRET: '' }, privy: verifier });
    const res = await other.inject({ method: 'POST', url: '/v1/webhooks/privy', payload: { type: 'user.created' }, headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,good' } });
    expect(res.statusCode).toBe(503);
    await other.close();
  });

  it('ignores an event type it does not sync', async () => {
    expect(await applyPrivyWebhook(db, 'msg_other', { type: 'wallet.transaction', user: privyUser() })).toBe('ignored');
  });
});
