// Bucket tokens had no Metaplex metadata, so every wallet, explorer and DEX showed them as unknown
// tokens. The program now derives the on-chain name and ticker from the bucket's name; these are the
// same cases as the Rust unit test in instructions/metadata.rs, so the two implementations cannot
// drift without one of them going red.
import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';

import { deriveSymbol, MAX_METADATA_NAME, MAX_METADATA_SYMBOL, Pdas, TOKEN_METADATA_PROGRAM_ID, truncateName } from '@bucket/sdk';

describe('derived token symbols', () => {
  // Keep in step with metadata.rs::tests::symbols_are_derived_from_the_name
  const cases: [string, string][] = [
    ['Tokenized SP500', 'TOKENIZEDS'],
    ['FAANG', 'FAANG'],
    ['AI & Robotics', 'AIROBOTICS'],
    ['  spaced  out  ', 'SPACEDOUT'],
    ['2024 Winners', '2024WINNER'],
    ['🚀🚀🚀', 'BUCKET'],
    ['', 'BUCKET'],
  ];

  for (const [name, symbol] of cases) {
    it(`${name || '(empty)'} → ${symbol}`, () => {
      expect(deriveSymbol(name)).toBe(symbol);
    });
  }

  it('never exceeds the Metaplex symbol limit', () => {
    expect(deriveSymbol('A'.repeat(48)).length).toBe(MAX_METADATA_SYMBOL);
  });
});

describe('names cut to the Metaplex limit', () => {
  it('leaves a short name alone', () => {
    expect(truncateName('Tokenized SP500')).toBe('Tokenized SP500');
  });

  it('cuts a 48-byte name to 32', () => {
    expect(truncateName('A'.repeat(48))).toHaveLength(MAX_METADATA_NAME);
  });

  it('never splits a multi-byte character', () => {
    // 'é' is two bytes, so 32 bytes is exactly 16 of them.
    const cut = truncateName('é'.repeat(20));
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(MAX_METADATA_NAME);
    expect(cut).toBe('é'.repeat(16));
  });
});

describe('metadata account address', () => {
  it('is the Metaplex PDA for the mint, not a bucket_vault PDA', () => {
    const mint = new PublicKey('A2wdEfMUNPpKf8eXUx4SiRmKkQGYVX39q1qAs4URDZe4');
    const expected = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID,
    )[0];
    expect(new Pdas().metadata(mint).toBase58()).toBe(expected.toBase58());
  });
});
