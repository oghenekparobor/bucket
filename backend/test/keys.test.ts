// Role keys must be supplyable without a file on disk: a container should never have secret files
// baked into its image, and platforms hand secrets over as environment variables.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { loadKeypair, parseKeypair, resolveKeypair } from '../src/chain/keys.js';

const kp = Keypair.generate();
const asJson = JSON.stringify(Array.from(kp.secretKey));
const asBase64 = Buffer.from(kp.secretKey).toString('base64');
const expected = kp.publicKey.toBase58();

const fileWith = (contents: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'bucket-keys-')), 'role.json');
  writeFileSync(path, contents);
  return path;
};

describe('role keys', () => {
  it('reads the Solana CLI JSON array', () => {
    expect(parseKeypair(asJson, 'TEST').publicKey.toBase58()).toBe(expected);
  });

  it('reads the same bytes base64-encoded', () => {
    expect(parseKeypair(asBase64, 'TEST').publicKey.toBase58()).toBe(expected);
  });

  it('tolerates the whitespace and newlines that .env files and secret managers add', () => {
    expect(parseKeypair(`  ${asJson}\n`, 'TEST').publicKey.toBase58()).toBe(expected);
    expect(parseKeypair(`\n${asBase64}  `, 'TEST').publicKey.toBase58()).toBe(expected);
  });

  it('still loads a keypair file', () => {
    expect(loadKeypair(fileWith(asJson)).publicKey.toBase58()).toBe(expected);
  });

  it('prefers the inline secret over the file path', () => {
    const other = fileWith(JSON.stringify(Array.from(Keypair.generate().secretKey)));
    expect(resolveKeypair(asJson, other, 'FEE_PAYER')?.publicKey.toBase58()).toBe(expected);
  });

  it('falls back to the file, and to null when neither is set', () => {
    expect(resolveKeypair(undefined, fileWith(asJson), 'FEE_PAYER')?.publicKey.toBase58()).toBe(expected);
    expect(resolveKeypair('   ', fileWith(asJson), 'FEE_PAYER')?.publicKey.toBase58()).toBe(expected); // blank env var is not a key
    expect(resolveKeypair(undefined, undefined, 'FEE_PAYER')).toBeNull();
  });

  it('names the variable but never echoes the secret when it is malformed', () => {
    const secret = 'not-a-key-but-still-secret';
    expect(() => resolveKeypair(secret, undefined, 'FEE_PAYER')).toThrow(/FEE_PAYER_KEYPAIR is not a Solana secret key/);
    try {
      resolveKeypair(secret, undefined, 'FEE_PAYER');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('rejects a key of the wrong length rather than accepting a truncated secret', () => {
    expect(() => parseKeypair(JSON.stringify(Array.from(kp.secretKey.slice(0, 32))), 'TEST')).toThrow(/not a Solana secret key/);
  });
});
