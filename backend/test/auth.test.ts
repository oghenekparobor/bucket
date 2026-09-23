import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BucketAuthenticator, devAuthMessage, type PrivyLike, signDevToken, solanaWallets, verifyDevToken } from '../src/api/auth.js';
import type { Db } from '../src/db/pool.js';
import { freshDb } from './helpers/db.js';

const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
const now = Math.floor(Date.now() / 1000);

describe('dev bearer tokens', () => {
  it('accepts dev:<wallet>:<ts>:<base58 sig> signed by the wallet', () => {
    expect(verifyDevToken(signDevToken(kp.secretKey, wallet, now), now, 86_400)).toBe(wallet);
  });

  it('accepts a base64 signature too', () => {
    const sig = nacl.sign.detached(new TextEncoder().encode(devAuthMessage(wallet, now)), kp.secretKey);
    expect(verifyDevToken(`dev:${wallet}:${now}:${Buffer.from(sig).toString('base64')}`, now, 86_400)).toBe(wallet);
  });

  it('rejects expired, future, forged and malformed tokens', () => {
    expect(() => verifyDevToken(signDevToken(kp.secretKey, wallet, now - 90_000), now, 86_400)).toThrow(/expired/);
    expect(() => verifyDevToken(signDevToken(kp.secretKey, wallet, now + 3_600), now, 86_400)).toThrow(/future/);
    const other = Keypair.generate();
    expect(() => verifyDevToken(signDevToken(other.secretKey, wallet, now), now, 86_400)).toThrow(/does not verify/);
    expect(() => verifyDevToken(`dev:${wallet}:${now}:${bs58.encode(new Uint8Array(10))}`, now, 86_400)).toThrow(/64 bytes/);
    expect(() => verifyDevToken('dev:nope', now, 86_400)).toThrow(/Malformed/);
  });
});

describe('Privy verification path (mocked Privy client)', () => {
  let db: Db;
  const embedded = Keypair.generate().publicKey.toBase58();
  const external = Keypair.generate().publicKey.toBase58();
  const privy: PrivyLike & { lookups: number } = {
    lookups: 0,
    async verifyAuthToken(token: string) {
      if (token !== 'good-token') throw new Error('invalid');
      return { userId: 'did:privy:alice' };
    },
    async getUserById() {
      this.lookups++;
      return {
        id: 'did:privy:alice',
        email: { address: 'alice@example.com' },
        twitter: { username: 'alice_x' },
        linkedAccounts: [
          { type: 'wallet', chainType: 'ethereum', address: '0xabc', walletClientType: 'metamask' },
          { type: 'wallet', chainType: 'solana', address: external, walletClientType: 'phantom', latestVerifiedAt: new Date() },
          { type: 'wallet', chainType: 'solana', address: embedded, walletClientType: 'privy' },
        ],
      };
    },
  };

  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(() => db.end());

  it('orders Solana wallets embedded-first', () => {
    return privy.getUserById('x').then((u) => expect(solanaWallets(u)).toEqual([embedded, external]));
  });

  it('verifies the access token, maps the user to the embedded wallet and caches the mapping', async () => {
    const auth = new BucketAuthenticator(db, { devMode: false, devMaxAgeSecs: 86_400, privy });
    const user = await auth.authenticate('Bearer good-token');
    expect(user).toMatchObject({ userId: 'did:privy:alice', wallet: embedded, email: 'alice@example.com', xHandle: 'alice_x', xVerified: true });
    await auth.authenticate('Bearer good-token');
    expect(privy.lookups).toBe(2); // one for the test above, one here; the second call was served from the users table
  });

  it('lets the client choose another of the user’s own Solana wallets, but not someone else’s', async () => {
    const auth = new BucketAuthenticator(db, { devMode: false, devMaxAgeSecs: 86_400, privy });
    expect((await auth.authenticate('Bearer good-token', external)).wallet).toBe(external);
    await expect(auth.authenticate('Bearer good-token', wallet)).rejects.toThrow(/not one of your Solana wallets/);
  });

  it('rejects bad tokens, missing headers, and dev tokens outside dev mode', async () => {
    const auth = new BucketAuthenticator(db, { devMode: false, devMaxAgeSecs: 86_400, privy });
    await expect(auth.authenticate('Bearer bad-token')).rejects.toThrow(/Invalid or expired/);
    await expect(auth.authenticate(undefined)).rejects.toThrow(/Missing bearer/);
    await expect(auth.authenticate(`Bearer ${signDevToken(kp.secretKey, wallet)}`)).rejects.toThrow(/disabled/);
  });

  it('accepts dev tokens in dev mode and creates the wallet user', async () => {
    const auth = new BucketAuthenticator(db, { devMode: true, devMaxAgeSecs: 86_400, privy: null });
    expect(await auth.authenticate(`Bearer ${signDevToken(kp.secretKey, wallet)}`)).toMatchObject({ userId: `dev:${wallet}`, wallet });
    await expect(auth.authenticate('Bearer good-token')).rejects.toThrow(/Privy is not configured/);
  });
});
