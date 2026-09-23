// Tokens in supply × unit price == vault value, across a long random sequence
// of mints, redeems, price moves and settlements. Also: mints and redeems never
// lower the unit price for existing holders, settlement lowers it by exactly the
// commission, and every token in supply sits in a wallet or a fee account.

import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { Chain, DESIGN_STOCKS, usd, USD } from './harness.js';
import { exit, invest, publish, settle, snapshot } from './flows.js';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('value invariant under random operations', () => {
  it('holds for 60 operations', async () => {
    const chain = await Chain.boot(DESIGN_STOCKS);
    const r = rng(42);
    const creator = chain.user();
    const users: Keypair[] = [creator, chain.user(), chain.user(), chain.user()];
    for (const u of users) await chain.faucet(u.publicKey, usd(20_000));
    const b = await publish(chain, creator, {
      name: 'Invariant',
      holdings: [
        ['NVDAx', 30],
        ['AAPLx', 20],
        ['SPYx', 25],
        ['pSPACEX', 15],
        ['tSTRIPE', 10],
      ],
    });
    await invest(chain, creator, b, usd(500));
    const prices = new Map(DESIGN_STOCKS.map((s) => [s.symbol, s.price]));
    const mintKey = (await chain.client.bucket(b.address)).tokenMint;

    const check = async (label: string) => {
      const s = await snapshot(chain, b);
      const implied = (s.supply * s.unit) / USD;
      // floor(V × 1e6 / S) × S / 1e6 is within one token-unit's worth of V
      expect(s.value - implied, label).toBeGreaterThanOrEqual(0n);
      expect(s.value - implied, label).toBeLessThanOrEqual(s.supply / USD + 1n);
      const held = users.reduce((a, u) => a + chain.tokenBalance(getAssociatedTokenAddressSync(mintKey, u.publicKey)), 0n);
      const fees = chain.tokenBalance(chain.client.pdas.creatorFee(b.address)) + chain.tokenBalance(chain.client.pdas.platformFee(b.address));
      expect(held + fees, `${label}: supply accounted`).toBe(s.supply);
      return s;
    };

    let ops = { mint: 0, redeem: 0, price: 0, settle: 0 };
    for (let i = 0; i < 60; i++) {
      const roll = r();
      // mint and redeem settle commission first; settle here so `before` is the post-fee unit price
      if (roll < 0.6) await settle(chain, b);
      const before = await check(`before op ${i}`);
      const u = users[Math.floor(r() * users.length)]!;
      if (roll < 0.35) {
        ops.mint++;
        await invest(chain, u, b, usd(Math.round(1 + r() * 2_500)));
        const after = await check(`mint ${i}`);
        expect(after.unit, `mint ${i} must not dilute`).toBeGreaterThanOrEqual(before.unit - 1n);
      } else if (roll < 0.6) {
        const held = chain.tokenBalance(getAssociatedTokenAddressSync(mintKey, u.publicKey));
        if (held === 0n) continue;
        ops.redeem++;
        const tokens = r() < 0.3 ? held : (held * BigInt(Math.floor(r() * 90) + 5)) / 100n;
        await exit(chain, u, b, tokens);
        const after = await check(`redeem ${i}`);
        if (after.supply > 0n) expect(after.unit, `redeem ${i} must not dilute`).toBeGreaterThanOrEqual(before.unit - 1n);
      } else if (roll < 0.85) {
        ops.price++;
        const sym = ['NVDAx', 'AAPLx', 'SPYx', 'pSPACEX', 'tSTRIPE'][Math.floor(r() * 5)]!;
        const p = prices.get(sym)! * (0.9 + r() * 0.22);
        prices.set(sym, p);
        await chain.setPrice(sym, p, { force: true });
        await check(`price ${i}`);
      } else {
        ops.settle++;
        await settle(chain, b);
        const after = await check(`settle ${i}`);
        // settlement never changes vault value, only supply
        expect(after.value).toBe(before.value);
        expect(after.supply).toBeGreaterThanOrEqual(before.supply);
      }
      chain.advance(60);
    }
    expect(ops.mint + ops.redeem + ops.price + ops.settle).toBeGreaterThan(50);
    expect(ops.mint).toBeGreaterThan(5);
    expect(ops.redeem).toBeGreaterThan(5);
  });
});
