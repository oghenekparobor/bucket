// Phase 1 goal, end to end: a creator builds a bucket, a second wallet mints
// tokens from it, redeems at a gain, and the creator receives commission tokens.

import { beforeAll, describe, expect, it } from 'vitest';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { Chain, DESIGN_STOCKS, USD, usd } from './harness.js';
import { exit, invest, publish, snapshot, type Published } from './flows.js';

describe('core loop: create → invest → gain → redeem → commission', () => {
  let chain: Chain;
  let b: Published;
  const creator = () => chain.stocks && creatorKp;
  let creatorKp: ReturnType<Chain['user']>;
  let backer: ReturnType<Chain['user']>;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creatorKp = chain.user();
    backer = chain.user();
    await chain.faucet(creatorKp.publicKey, usd(1_000));
    await chain.faucet(backer.publicKey, usd(5_000));
  });

  it('publishes a bucket with a pre-IPO holding', async () => {
    b = await publish(chain, creator(), {
      name: 'Frontier Labs',
      thesis: 'Compute and the models that run on it.',
      holdings: [
        ['NVDAx', 40],
        ['MSFTx', 35],
        ['pSPACEX', 25],
      ],
    });
    expect(b.bucket.name).toBe('Frontier Labs');
    expect(b.bucket.holdings.map((h) => h.weightBps)).toEqual([4_000, 3_500, 2_500]);
    expect(BigInt(b.bucket.hwmE6.toString())).toBe(100n * USD);
    expect(chain.eventsNamed('BucketCreated')).toHaveLength(1);
  });

  it('creator funds it first: $500 at a $100 unit price', async () => {
    const tokens = await invest(chain, creator(), b, usd(500));
    const s = await snapshot(chain, b);
    // $500 less the 0.20% fee and swap costs (10 bps venue fee, 1% SpaceX transfer fee on 25%)
    expect(tokens).toBeGreaterThan(4_950_000n);
    expect(tokens).toBeLessThan(4_990_000n);
    expect(s.supply).toBe(tokens);
    // unit price stays at or above the $100 start: the minter pays their own swap costs
    expect(s.unit).toBeGreaterThanOrEqual(100n * USD - 1n);
    expect(s.bucket.creatorFunded).toBe(true);
  });

  it('a second wallet invests $2,000 without moving the unit price', async () => {
    const before = await snapshot(chain, b);
    const tokens = await invest(chain, backer, b, usd(2_000));
    const after = await snapshot(chain, b);
    expect(tokens).toBeGreaterThan(19_700_000n);
    expect(after.supply).toBe(before.supply + tokens);
    // unit price does not fall for existing holders (tiny rounding only in their favour)
    expect(after.unit).toBeGreaterThanOrEqual(before.unit - 1n);
    expect(after.unit - before.unit).toBeLessThan(usd(0.05));
    // supply × unit price == vault value, to rounding
    const implied = (after.supply * after.unit) / 1_000_000n;
    expect(after.value - implied).toBeLessThan(after.supply / 1_000_000n + 2n);
  });

  it('stocks rise 20%: settlement pays the creator 80% and the platform 20% in new tokens', async () => {
    for (const s of ['NVDAx', 'MSFTx', 'pSPACEX']) {
      const p = DESIGN_STOCKS.find((x) => x.symbol === s)!.price * 1.2;
      await chain.setPrice(s, p, { force: true });
    }
    const before = await snapshot(chain, b);
    await import('./flows.js').then((f) => f.settle(chain, b));
    const ev = chain.eventsNamed('CommissionSettled').at(-1)!.data as Record<string, string>;
    const creatorTokens = BigInt(ev.creator_tokens!);
    const platformTokens = BigInt(ev.platform_tokens!);
    expect(creatorTokens).toBeGreaterThan(0n);
    // 80/20 split
    expect(platformTokens * 4n - creatorTokens).toBeLessThanOrEqual(4n);
    const after = await snapshot(chain, b);
    expect(after.supply).toBe(before.supply + creatorTokens + platformTokens);
    // commission is 20% of the gain above the $100 mark
    const gain = ((before.unit - 100n * USD) * before.supply) / 1_000_000n;
    expect(BigInt(ev.commission_e6!)).toBeGreaterThanOrEqual((gain * 2_000n) / 10_000n - 10n);
    // the mark moves to the post-fee unit price
    expect(after.hwm).toBe(after.unit);
    const creatorFee = chain.tokenBalance(chain.client.pdas.creatorFee(b.address));
    expect(creatorFee).toBe(creatorTokens);
  });

  it('backer redeems everything at a gain, paid in USDC', async () => {
    const bucket = (await snapshot(chain, b)).bucket;
    const ata = getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey, true);
    const tokens = chain.tokenBalance(ata);
    const got = await exit(chain, backer, b, tokens);
    expect(chain.tokenBalance(ata)).toBe(0n);
    // paid $2,000; after a 20% rise less 20% commission on the gain, less costs: ~ $2,300
    expect(got).toBeGreaterThan(usd(2_250));
    expect(got).toBeLessThan(usd(2_400));
  });

  it('creator claims commission tokens to their wallet', async () => {
    const bucket = (await snapshot(chain, b)).bucket;
    const config = await chain.client.config();
    const ixs = await chain.client.claimFeesIxs({
      signer: creator().publicKey,
      payer: creator().publicKey,
      bucketAddress: b.address,
      bucket,
      config,
      creator: true,
    });
    const owed = chain.tokenBalance(chain.client.pdas.creatorFee(b.address));
    await chain.send(ixs, [creator()]);
    const ata = getAssociatedTokenAddressSync(bucket.tokenMint, creator().publicKey, true);
    expect(owed).toBeGreaterThan(0n);
    expect(chain.tokenBalance(chain.client.pdas.creatorFee(b.address))).toBe(0n);
    expect(chain.tokenBalance(ata)).toBeGreaterThan(owed);
  });
});
