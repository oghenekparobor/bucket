import { describe, expect, it } from 'vitest';
import { planRebalance } from '../src/keeper/rebalancePlan.js';
import { MAX_GAP_MS, MIN_GAP_MS, nextSettleAt } from '../src/keeper/schedule.js';
import { sustainedGap } from '../src/jobs/poolMonitor.js';
import { HOUR_MS } from '../src/util/time.js';

const usd = (n: number) => BigInt(Math.round(n * 1e6));

describe('settlement schedule', () => {
  it('settles 12–24h after the last settlement, at a random point', () => {
    const last = 1_000 * HOUR_MS;
    expect(nextSettleAt(last, last, () => 0)).toBe(last + MIN_GAP_MS);
    expect(nextSettleAt(last, last, (n) => n - 1)).toBe(last + MAX_GAP_MS - 1);
  });

  it('settles within 30 minutes when overdue', () => {
    const now = 5_000 * HOUR_MS;
    const next = nextSettleAt(now - 3 * 24 * HOUR_MS, now, (n) => n - 1);
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThan(30 * 60_000);
  });
});

describe('rebalance planning', () => {
  it('sells over-weight holdings into under-weight ones with a slippage-bounded minimum', () => {
    // $600 A / $400 B with a 50/50 target → sell $100 of A into B.
    const trades = planRebalance(
      [
        { mint: 'A', available: 6_000_000n, priceE6: usd(100), decimals: 6, weightBps: 5_000 },
        { mint: 'B', available: 40_000_000n, priceE6: usd(10), decimals: 6, weightBps: 5_000 },
      ],
      100,
    );
    expect(trades).toEqual([{ fromMint: 'A', toMint: 'B', qtyIn: 1_000_000n, valueE6: usd(100), minOut: 9_900_000n }]);
  });

  it('fully sells a removed holding and ignores dust under the tolerance', () => {
    const trades = planRebalance(
      [
        { mint: 'OLD', available: 1_000_000n, priceE6: usd(100), decimals: 6, weightBps: 0 },
        { mint: 'A', available: 4_500_000n, priceE6: usd(100), decimals: 6, weightBps: 5_000 },
        { mint: 'B', available: 4_500_000n, priceE6: usd(100), decimals: 6, weightBps: 5_000 },
      ],
      100,
    );
    expect(trades.reduce((a, t) => a + t.qtyIn, 0n)).toBe(1_000_000n);
    expect(new Set(trades.map((t) => t.fromMint))).toEqual(new Set(['OLD']));
    expect(planRebalance([{ mint: 'A', available: 5_010_000n, priceE6: usd(1), decimals: 6, weightBps: 5_000 }, { mint: 'B', available: 4_990_000n, priceE6: usd(1), decimals: 6, weightBps: 5_000 }], 100)).toEqual([]);
  });
});

describe('pool gap alert', () => {
  const now = 10 * HOUR_MS;
  it('fires only when every sample over the last hour is more than 1% away', () => {
    const every5 = (gap: number) => Array.from({ length: 14 }, (_, i) => ({ t: now - 65 * 60_000 + i * 5 * 60_000, gapPct: gap }));
    expect(sustainedGap(every5(1.4), now, 1)).toBe(true);
    expect(sustainedGap(every5(-1.2), now, 1)).toBe(true);
    const dip = every5(1.4).map((s, i) => (i === 7 ? { ...s, gapPct: 0.4 } : s));
    expect(sustainedGap(dip, now, 1)).toBe(false);
    expect(sustainedGap(every5(1.4).slice(4), now, 1)).toBe(false); // under an hour of data
  });
});
