/** Transaction helpers: base64 <-> VersionedTransaction, and a sanity check before signing. */
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

export function decodeTx(b64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(b64));
}

export function encodeTx(tx: VersionedTransaction): string {
  return bytesToBase64(tx.serialize());
}

/**
 * Decides what to do with a transaction the backend built, before anything reaches the wallet:
 * - `sign`: the user is a required signer (never the fee payer: fees are sponsored, so the Bucket fee
 *   payer is signer 0);
 * - `relay`: the user is not a signer and Bucket already signed it completely (e.g. the vault accounts
 *   and lookup table of a publish), so it is submitted as is without asking the wallet.
 * Anything else is refused.
 */
export function signingPlan(tx: VersionedTransaction, wallet: string): 'sign' | 'relay' {
  const msg = tx.message;
  const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures);
  const idx = signers.findIndex((k) => k.equals(new PublicKey(wallet)));
  if (idx === 0) throw new Error('This transaction would make you pay the network fee, which Bucket sponsors. It was not signed.');
  if (idx > 0) return 'sign';
  if (tx.signatures.every((s) => s.some((b) => b !== 0))) return 'relay';
  throw new Error('This transaction is missing a signature that is not yours. It was not sent.');
}
