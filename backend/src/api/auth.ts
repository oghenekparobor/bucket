/**
 * Write authentication (docs/architecture.md §3). Production: `Authorization: Bearer <Privy access
 * token>`, verified with @privy-io/server-auth, then the Privy user is mapped to a Solana wallet
 * (embedded wallet first, else the most recently linked external Solana wallet; a client may pick
 * another of the user's own Solana wallets with `X-Bucket-Wallet`). Dev (`AUTH_MODE=dev`) also accepts
 * `dev:<wallet>:<unix_ts>:<sig>` where sig is the base58 (or base64) ed25519 signature of
 * `bucket-dev-auth:<wallet>:<unix_ts>` by the wallet's key.
 */
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { Queryable } from '../db/pool.js';
import { unauthorized } from './errors.js';

export interface AuthUser {
  userId: string;
  privyId: string | null;
  wallet: string;
  email: string | null;
  xHandle: string | null;
  xVerified: boolean;
}

export interface Authenticator {
  authenticate(authorization: string | undefined, walletHint?: string): Promise<AuthUser>;
}

// ─── Dev tokens ───────────────────────────────────────────────────────────────────────────────────────

export const DEV_AUTH_PREFIX = 'bucket-dev-auth';
const FUTURE_SKEW_SECS = 300;

export function devAuthMessage(wallet: string, ts: number): string {
  return `${DEV_AUTH_PREFIX}:${wallet}:${ts}`;
}

function decodeSignature(sig: string): Uint8Array | null {
  try {
    const b58 = bs58.decode(sig);
    if (b58.length === 64) return b58;
  } catch {
    // not base58, try base64
  }
  const b64 = Buffer.from(sig, 'base64');
  return b64.length === 64 ? new Uint8Array(b64) : null;
}

/** Verifies a dev bearer token and returns the wallet it proves control of. Throws 401 otherwise. */
export function verifyDevToken(token: string, nowSecs: number, maxAgeSecs: number): string {
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== 'dev') throw unauthorized('Malformed dev token');
  const [, wallet, tsRaw, sig] = parts as [string, string, string, string];
  const ts = Number(tsRaw);
  if (!Number.isInteger(ts)) throw unauthorized('Malformed dev token timestamp');
  if (ts > nowSecs + FUTURE_SKEW_SECS) throw unauthorized('Dev token timestamp is in the future');
  if (nowSecs - ts > maxAgeSecs) throw unauthorized('Dev token expired');
  let pubkey: Uint8Array;
  try {
    pubkey = new PublicKey(wallet).toBytes();
  } catch {
    throw unauthorized('Dev token wallet is not a valid address');
  }
  const signature = decodeSignature(sig);
  if (!signature) throw unauthorized('Dev token signature must be 64 bytes, base58 or base64');
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(devAuthMessage(wallet, ts)), signature, pubkey);
  if (!ok) throw unauthorized('Dev token signature does not verify');
  return wallet;
}

/** Builds a dev token for a keypair secret key (used by tests and local scripts). */
export function signDevToken(secretKey: Uint8Array, wallet: string, ts = Math.floor(Date.now() / 1000)): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(devAuthMessage(wallet, ts)), secretKey);
  return `dev:${wallet}:${ts}:${bs58.encode(sig)}`;
}

// ─── Privy ────────────────────────────────────────────────────────────────────────────────────────────

/** The slice of the Privy server client this module uses (mockable in tests). */
export interface PrivyLike {
  verifyAuthToken(token: string): Promise<{ userId: string }>;
  getUserById(userId: string): Promise<PrivyUserLike>;
}

export interface PrivyUserLike {
  id: string;
  email?: { address: string } | null;
  twitter?: { username: string | null } | null;
  linkedAccounts: {
    type: string;
    address?: string;
    chainType?: string;
    walletClientType?: string;
    latestVerifiedAt?: Date | string | null;
  }[];
}

/** The user's Solana wallets, embedded (Privy) first, then external by most recent verification. */
export function solanaWallets(user: PrivyUserLike): string[] {
  const wallets = user.linkedAccounts.filter((a) => a.type === 'wallet' && a.chainType === 'solana' && a.address);
  const time = (a: (typeof wallets)[number]) => (a.latestVerifiedAt ? new Date(a.latestVerifiedAt).getTime() : 0);
  const embedded = wallets.filter((a) => a.walletClientType === 'privy');
  const external = wallets.filter((a) => a.walletClientType !== 'privy').sort((a, b) => time(b) - time(a));
  return [...embedded, ...external].map((a) => a.address!);
}

const PRIVY_REFRESH_MS = 10 * 60_000;

interface UserRow {
  id: string;
  privy_id: string | null;
  wallet: string;
  email: string | null;
  x_handle: string | null;
  x_verified: boolean;
}

export class BucketAuthenticator implements Authenticator {
  constructor(
    private readonly db: Queryable,
    private readonly opts: { devMode: boolean; devMaxAgeSecs: number; privy: PrivyLike | null },
  ) {}

  async authenticate(authorization: string | undefined, walletHint?: string): Promise<AuthUser> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
    if (!token) throw unauthorized('Missing bearer token');
    if (token.startsWith('dev:')) {
      if (!this.opts.devMode) throw unauthorized('Dev tokens are disabled (AUTH_MODE is not dev)');
      const wallet = verifyDevToken(token, Math.floor(Date.now() / 1000), this.opts.devMaxAgeSecs);
      return this.toAuthUser(await this.upsertWalletUser(wallet), `dev:${wallet}`);
    }
    if (!this.opts.privy) throw unauthorized('Privy is not configured (set PRIVY_APP_ID and PRIVY_APP_SECRET)');
    let claims: { userId: string };
    try {
      claims = await this.opts.privy.verifyAuthToken(token);
    } catch {
      throw unauthorized('Invalid or expired Privy access token');
    }
    const row = await this.privyUser(claims.userId, walletHint);
    return this.toAuthUser(row, claims.userId);
  }

  private toAuthUser(row: UserRow, userId: string): AuthUser {
    return { userId, privyId: row.privy_id, wallet: row.wallet, email: row.email, xHandle: row.x_handle, xVerified: row.x_verified };
  }

  private async upsertWalletUser(wallet: string): Promise<UserRow> {
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (wallet) VALUES ($1) ON CONFLICT (wallet) DO UPDATE SET updated_at = now()
       RETURNING id, privy_id, wallet, email, x_handle, x_verified`,
      [wallet],
    );
    return r.rows[0]!;
  }

  /** Maps a Privy user to our users row, refreshing linked accounts from Privy at most every 10 minutes. */
  private async privyUser(privyId: string, walletHint?: string): Promise<UserRow> {
    const cached = await this.db.query<UserRow & { privy_synced_at: Date | null }>(
      'SELECT id, privy_id, wallet, email, x_handle, x_verified, privy_synced_at FROM users WHERE privy_id = $1',
      [privyId],
    );
    const row = cached.rows[0];
    const fresh = row?.privy_synced_at && Date.now() - row.privy_synced_at.getTime() < PRIVY_REFRESH_MS;
    if (row && fresh && (!walletHint || walletHint === row.wallet)) return row;

    const user = await this.opts.privy!.getUserById(privyId);
    const wallets = solanaWallets(user);
    if (wallets.length === 0) throw unauthorized('This Privy user has no Solana wallet');
    if (walletHint && !wallets.includes(walletHint)) throw unauthorized('X-Bucket-Wallet is not one of your Solana wallets');
    const wallet = walletHint ?? wallets[0]!;
    const xHandle = user.twitter?.username ?? null;
    // A wallet belongs to one user: detach it from any older row (e.g. a dev-auth or pre-Privy row).
    await this.db.query('UPDATE users SET wallet = NULL WHERE wallet = $1 AND privy_id IS DISTINCT FROM $2', [wallet, privyId]);
    const r = await this.db.query<UserRow>(
      `INSERT INTO users (privy_id, wallet, email, x_handle, x_verified, privy_synced_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (privy_id) DO UPDATE SET wallet = EXCLUDED.wallet, email = COALESCE(EXCLUDED.email, users.email),
         x_handle = EXCLUDED.x_handle, x_verified = EXCLUDED.x_verified, privy_synced_at = now(), updated_at = now()
       RETURNING id, privy_id, wallet, email, x_handle, x_verified`,
      [privyId, wallet, user.email?.address ?? null, xHandle, xHandle !== null],
    );
    return r.rows[0]!;
  }
}
