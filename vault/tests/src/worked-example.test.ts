// The spec's commission worked example, reproduced on-chain:
// $100,000 vault → $125 → fee → $120 mark, supply 1,041.67 → fall to $108 → recover to $130 → fee → $128, supply 1,057.94.
// Venue fees and the mint fee are zeroed so the arithmetic is exactly the spec's.

import { beforeAll, describe, expect, it } from 'vitest';

import { Chain, USD, usd } from './harness.js';
import { invest, publish, settle, snapshot, type Published } from './flows.js';

const fmt = (x: bigint, dp = 2) => (Number(x) / 1e6).toFixed(dp);

describe('commission worked example (spec table)', () => {
  let chain: Chain;
  let b: Published;
  let creator: ReturnType<Chain['user']>;

  beforeAll(async () => {
    chain = await Chain.boot(
      [
        { symbol: 'AAA', price: 100, source: 'xStocks', kind: 'publicStock', swapFeeBps: 0 },
        { symbol: 'BBB', price: 100, source: 'xStocks', kind: 'publicStock', swapFeeBps: 0 },
      ],
      { mintFeeBps: 0 },
    );
    creator = chain.user();
    await chain.faucet(creator.publicKey, usd(100_000));
    b = await publish(chain, creator, { name: 'Worked example', holdings: [['AAA', 50], ['BBB', 50]] });
  });

  const price = async (p: number) => {
    await chain.setPrice('AAA', p, { force: true });
    await chain.setPrice('BBB', p, { force: true });
  };
  const lastSettlement = () => chain.eventsNamed('CommissionSettled').at(-1)?.data as Record<string, string> | undefined;

  it('launch with a $100,000 vault: unit price $100, 1,000.00 tokens', async () => {
    const tokens = await invest(chain, creator, b, usd(100_000));
    const s = await snapshot(chain, b);
    expect(tokens).toBe(1_000n * USD);
    expect(s.value).toBe(usd(100_000));
    expect(s.unit).toBe(100n * USD);
    expect(s.hwm).toBe(100n * USD);
  });

  it('stocks rise 25%: commission $5,000, creator $4,000, platform $1,000', async () => {
    await price(125);
    const before = await snapshot(chain, b);
    expect(before.unit).toBe(125n * USD);
    await settle(chain, b);
    const ev = lastSettlement()!;
    expect(fmt(BigInt(ev.commission_e6!))).toBe('5000.00');
    const s = await snapshot(chain, b);
    // After fee tokens are minted: $120.00 unit price and mark, 1,041.67 tokens
    expect(fmt(s.unit)).toBe('120.00');
    expect(fmt(s.hwm)).toBe('120.00');
    expect(fmt(s.supply)).toBe('1041.67');
    const creatorUsd = (BigInt(ev.creator_tokens!) * s.unit) / USD;
    const platformUsd = (BigInt(ev.platform_tokens!) * s.unit) / USD;
    expect(Math.round(Number(creatorUsd) / 1e6)).toBe(4_000);
    expect(Math.round(Number(platformUsd) / 1e6)).toBe(1_000);
  });

  it('stocks fall 10%: unit price $108, no commission', async () => {
    await price(112.5);
    const n = chain.eventsNamed('CommissionSettled').length;
    await settle(chain, b);
    expect(chain.eventsNamed('CommissionSettled')).toHaveLength(n);
    const s = await snapshot(chain, b);
    expect(fmt(s.unit)).toBe('108.00');
    expect(fmt(s.hwm)).toBe('120.00');
  });

  it('stocks recover to a $130 unit price: commission $2,083, mark $128, supply 1,057.94', async () => {
    // 1,000 shares back 1,041.67 tokens, so a $130 unit price needs a $135.4167 share price
    await price(135.416667);
    const before = await snapshot(chain, b);
    expect(fmt(before.unit)).toBe('130.00');
    await settle(chain, b);
    const ev = lastSettlement()!;
    expect(Math.floor(Number(BigInt(ev.commission_e6!)) / 1e6)).toBe(2_083);
    const creatorUsd = Number((BigInt(ev.creator_tokens!) * BigInt(ev.hwm_after_e6!)) / USD) / 1e6;
    const platformUsd = Number((BigInt(ev.platform_tokens!) * BigInt(ev.hwm_after_e6!)) / USD) / 1e6;
    expect(Math.round(creatorUsd)).toBe(1_667);
    expect(Math.round(platformUsd)).toBe(417);
    const s = await snapshot(chain, b);
    expect(fmt(s.unit)).toBe('128.00');
    expect(fmt(s.hwm)).toBe('128.00');
    expect(fmt(s.supply)).toBe('1057.94');
  });

  it('a holder from launch is up 28%', async () => {
    const s = await snapshot(chain, b);
    expect(Number(s.unit) / 100e6 - 1).toBeCloseTo(0.28, 4);
  });
});
