import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

/** Loads a Solana CLI keypair file (JSON array of 64 bytes). */
export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}
