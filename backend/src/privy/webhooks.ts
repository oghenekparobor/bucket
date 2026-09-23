/**
 * Privy webhook events → the `users` table.
 *
 * Without this, Bucket only learns about a user's linked accounts when that user next makes an
 * authenticated request (the 10-minute refresh in api/auth.ts). Webhooks close the gap for things
 * that happen while the user is away: linking or unlinking X (the verified badge), changing the
 * email notifications go to, a new embedded wallet, and account deletion.
 *
 * Trust: the route verifies the signature before calling this. Even so, a webhook only ever updates
 * profile details — the wallet a transaction is built for still comes from the verified access
 * token on the request itself.
 */
import { solanaWallets, type PrivyUserLike } from '../api/auth.js';
import type { Queryable } from '../db/pool.js';

export interface PrivyWebhookEvent {
  type: string;
  user?: PrivyUserLike;
}

export type WebhookOutcome = 'applied' | 'deleted' | 'duplicate' | 'ignored';

/** Events that carry a full user object we can sync from. */
const SYNC_EVENTS = new Set([
  'user.created',
  'user.authenticated',
  'user.linked_account',
  'user.unlinked_account',
  'user.updated_account',
  'user.wallet_created',
  'user.transferred_account',
]);

export async function applyPrivyWebhook(db: Queryable, deliveryId: string, event: PrivyWebhookEvent): Promise<WebhookOutcome> {
  const privyId = event.user?.id ?? null;
  const inserted = await db.query(
    `INSERT INTO privy_webhook_events (delivery_id, type, privy_id, payload) VALUES ($1, $2, $3, $4)
     ON CONFLICT (delivery_id) DO NOTHING`,
    [deliveryId, event.type, privyId, JSON.stringify(event)],
  );
  if (!inserted.rowCount) return 'duplicate'; // Privy retries until it gets a 2xx

  if (!event.user?.id) return 'ignored';
  if (event.type === 'user.deleted') {
    // Keep the wallet (their on-chain history is public and stays), drop everything personal.
    await db.query(
      `UPDATE users SET privy_id = NULL, email = NULL, x_handle = NULL, x_verified = false,
         telegram_chat_id = NULL, display_name = NULL, deleted_at = now(), updated_at = now()
       WHERE privy_id = $1`,
      [event.user.id],
    );
    return 'deleted';
  }
  if (!SYNC_EVENTS.has(event.type)) return 'ignored';

  const user = event.user;
  const wallet = solanaWallets(user)[0] ?? null;
  const xHandle = user.twitter?.username ?? null;
  if (wallet) {
    // A wallet belongs to one user: detach it from any older row.
    await db.query('UPDATE users SET wallet = NULL WHERE wallet = $1 AND privy_id IS DISTINCT FROM $2', [wallet, user.id]);
  }
  await db.query(
    `INSERT INTO users (privy_id, wallet, email, x_handle, x_verified, privy_synced_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (privy_id) DO UPDATE SET
       wallet = COALESCE(EXCLUDED.wallet, users.wallet),
       -- an email the user set for notifications survives an unlink in Privy
       email = COALESCE(EXCLUDED.email, users.email),
       x_handle = EXCLUDED.x_handle,
       x_verified = EXCLUDED.x_verified,
       privy_synced_at = now(),
       updated_at = now()`,
    [user.id, wallet, user.email?.address ?? null, xHandle, xHandle !== null],
  );
  return 'applied';
}

/** Drops webhook payloads older than `days` (they are only kept for debugging). */
export async function prunePrivyWebhooks(db: Queryable, days = 30): Promise<number> {
  const r = await db.query(`DELETE FROM privy_webhook_events WHERE received_at < now() - ($1 || ' days')::interval`, [String(days)]);
  return r.rowCount ?? 0;
}
