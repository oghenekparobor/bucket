// Regression for a publish that failed on devnet with "VersionedTransaction too large: 1696 bytes
// (max: encoded/raw 1644/1232)". The lookup table for a bucket with many holdings needs ~58
// addresses; packing the table's `create` instruction together with a full `extend` overflowed the
// 1232-byte limit. Every transaction the publish flow builds must fit on its own.

import { describe, expect, it } from 'vitest';
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import { ADDRESSES_PER_EXTEND, BucketClient, MAX_TX_BYTES } from '@bucket/sdk';

const client = new BucketClient({ rpcEndpoint: 'http://localhost:8899' } as never);
const payer = Keypair.generate().publicKey;
const keys = (n: number) => Array.from({ length: n }, () => Keypair.generate().publicKey);

/** Serialized size of a signed v0 transaction carrying these instructions. */
function txSize(instructions: TransactionInstruction[]): number {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions }).compileToV0Message();
  return new VersionedTransaction(msg).serialize().length;
}

describe('lookup table transactions fit Solana’s size limit', () => {
  // 15 holdings is the largest recipe: ~13 fixed addresses + 3 per holding.
  for (const holdings of [2, 4, 8, 15]) {
    it(`${holdings} holdings: create and every extend fit on their own`, () => {
      const addresses = keys(13 + holdings * 3);
      const lt = client.lookupTableIxs(payer, payer, 1, addresses);
      expect(txSize([lt.create])).toBeLessThanOrEqual(MAX_TX_BYTES);
      for (const ix of lt.extends) expect(txSize([ix])).toBeLessThanOrEqual(MAX_TX_BYTES);
      expect(lt.extends).toHaveLength(Math.ceil(addresses.length / ADDRESSES_PER_EXTEND));
      // every address ends up in exactly one extend (12 bytes of header, then 32 per address)
      const written = lt.extends.reduce((n, ix) => n + (ix.data.length - 12) / 32, 0);
      expect(written).toBe(addresses.length);
    });
  }

  it('the shape that failed on devnet: create packed with a 30-address extend is over the limit', () => {
    const table = Keypair.generate().publicKey;
    const [create] = AddressLookupTableProgram.createLookupTable({ authority: payer, payer, recentSlot: 1 });
    const extend30 = AddressLookupTableProgram.extendLookupTable({ authority: payer, payer, lookupTable: table, addresses: keys(30) });
    expect(txSize([create, extend30])).toBeGreaterThan(MAX_TX_BYTES);
    // one instruction per transaction, at the current chunk size, is comfortably inside it
    const extend = AddressLookupTableProgram.extendLookupTable({ authority: payer, payer, lookupTable: table, addresses: keys(ADDRESSES_PER_EXTEND) });
    expect(txSize([create])).toBeLessThan(MAX_TX_BYTES);
    expect(txSize([extend])).toBeLessThan(MAX_TX_BYTES);
  });
});
