/**
 * Role keys (fee payer, keeper, price authority).
 *
 * A container has no keys/ directory and should not have secret files baked into its image, so each
 * role can be supplied two ways: `<ROLE>_KEYPAIR` carries the secret itself (the Solana CLI's JSON
 * array, or those same bytes base64-encoded, which survives .env files and secret managers that
 * dislike newlines), and `<ROLE>_KEYPAIR_PATH` points at a CLI keypair file. The inline value wins.
 */
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

/** Parses a Solana secret key: a JSON array of 64 bytes, or those bytes base64-encoded. */
export function parseKeypair(value: string, source: string): Keypair {
  const text = value.trim();
  try {
    const bytes = text.startsWith('[')
      ? Uint8Array.from(JSON.parse(text) as number[])
      : new Uint8Array(Buffer.from(text, 'base64'));
    return Keypair.fromSecretKey(bytes);
  } catch (err) {
    // The message never repeats the value: it is a secret, and this lands in logs.
    throw new Error(`${source} is not a Solana secret key (expected a JSON array of 64 bytes, or base64): ${(err as Error).message}`);
  }
}

/** Loads a Solana CLI keypair file (JSON array of 64 bytes). */
export function loadKeypair(path: string): Keypair {
  return parseKeypair(readFileSync(path, 'utf8'), path);
}

/**
 * A role's key from the inline secret if set, else the file, else null when neither is configured
 * (the API runs read-only without keys; the keeper checks for its own and exits).
 */
export function resolveKeypair(inline: string | undefined, path: string | undefined, role: string): Keypair | null {
  if (inline && inline.trim()) return parseKeypair(inline, `${role}_KEYPAIR`);
  return path ? loadKeypair(path) : null;
}
