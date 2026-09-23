/**
 * Dev auth: a local ed25519 keypair in localStorage acts as the wallet. The bearer token format is
 * architecture §3: dev:<wallet>:<unix_ts>:<base58 signature of "bucket-dev-auth:<wallet>:<unix_ts>">.
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const KEY = 'bucket.devWallet.v1';
const SESSION = 'bucket.devSession.v1';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDevKeypair(): Keypair | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    return null;
  }
}

export function createDevKeypair(): Keypair {
  const kp = Keypair.generate();
  storage()?.setItem(KEY, bs58.encode(kp.secretKey));
  return kp;
}

/** Accepts a base58 64-byte secret key (Phantom export format) or a JSON byte array (solana-keygen). */
export function importDevKeypair(input: string): Keypair {
  const s = input.trim();
  let bytes: Uint8Array;
  if (s.startsWith('[')) bytes = Uint8Array.from(JSON.parse(s) as number[]);
  else bytes = bs58.decode(s);
  const kp = Keypair.fromSecretKey(bytes);
  storage()?.setItem(KEY, bs58.encode(kp.secretKey));
  return kp;
}

export function devSessionActive(): boolean {
  return storage()?.getItem(SESSION) === '1';
}

export function setDevSession(on: boolean): void {
  const st = storage();
  if (!st) return;
  if (on) st.setItem(SESSION, '1');
  else st.removeItem(SESSION);
}

export function devBearer(kp: Keypair, nowSec = Math.floor(Date.now() / 1000)): string {
  const wallet = kp.publicKey.toBase58();
  const msg = new TextEncoder().encode(`bucket-dev-auth:${wallet}:${nowSec}`);
  const sig = nacl.sign.detached(msg, kp.secretKey);
  return `dev:${wallet}:${nowSec}:${bs58.encode(sig)}`;
}
