import { describe, expect, it } from 'vitest';
import { contributions, maxDrawdown, periodReturn, sample } from '../src/perf/metrics.js';
import { computeSeries, hourlyTimes } from '../src/perf/series.js';
import { DAY_MS, HOUR_MS } from '../src/util/time.js';

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const tok = (n: number) => BigInt(Math.round(n * 1e6));

describe('hourly unit price from event logs', () => {
  // One bucket, two 6-decimal holdings; 10 tokens minted at t=1h, price of A doubles at t=3h,
  // a redeem reserves half of A at t=4h, commission raises the high-water mark at t=5h.
  const history = {
    decimals: { A: 6, B: 6 },
    balances: [
      { ts: 1 * HOUR_MS, mint: 'A', balance: tok(5), reserved: 0n },
      { ts: 1 * HOUR_MS, mint: 'B', balance: tok(5), reserved: 0n },
      { ts: 4 * HOUR_MS, mint: 'A', balance: tok(5), reserved: tok(2.5) },
    ],
    supplies: [
      { ts: 1 * HOUR_MS, supply: tok(10) },
      { ts: 4 * HOUR_MS, supply: tok(7.5) },
    ],
    hwms: [{ ts: 5 * HOUR_MS, hwmE6: usd(140) }],
    prices: {
      A: [{ ts: 0, priceE6: usd(100) }, { ts: 3 * HOUR_MS, priceE6: usd(200) }],
      B: [{ ts: 0, priceE6: usd(100) }],
    },
  };

  it('values available balances (balance − reserved) at the latest price and divides by supply', () => {
    const pts = computeSeries(history, hourlyTimes(0, 5 * HOUR_MS));
    expect(pts.map((p) => p.t)).toEqual([1, 2, 3, 4, 5].map((h) => h * HOUR_MS)); // hour 0: no supply yet, skipped
    expect(pts[0]!.unitPriceE6).toBe(usd(100));
    expect(pts[2]!.unitPriceE6).toBe(usd(150)); // A doubled: (5×200 + 5×100) / 10
    expect(pts[3]!.vaultValueE6).toBe(usd(1_000)); // 2.5 A available × 200 + 5 B × 100
    expect(pts[3]!.unitPriceE6).toBe(usd(133.333333));
    expect(pts[4]!.hwmE6).toBe(usd(140));
  });

  it('skips points where a held mint has no price yet', () => {
    const pts = computeSeries({ ...history, prices: { A: history.prices.A } }, [2 * HOUR_MS]);
    expect(pts).toEqual([]);
  });
});

describe('returns and drawdown', () => {
  const now = 100 * DAY_MS;
  const pts = [
    { t: now - 95 * DAY_MS, u: 100 },
    { t: now - 90 * DAY_MS, u: 110 },
    { t: now - 30 * DAY_MS, u: 132 },
    { t: now - 20 * DAY_MS, u: 99 },
    { t: now - 7 * DAY_MS, u: 120 },
    { t: now, u: 126 },
  ];
  const created = now - 95 * DAY_MS;

  it('measures each period from the unit price at its start; "all" from the $100 launch price', () => {
    expect(periodReturn(pts, '7d', created)).toBeCloseTo(5, 6);
    expect(periodReturn(pts, '30d', created)).toBeCloseTo((126 / 132 - 1) * 100, 6);
    expect(periodReturn(pts, '90d', created)).toBeCloseTo((126 / 110 - 1) * 100, 6);
    expect(periodReturn(pts, 'all', created)).toBeCloseTo(26, 6);
  });

  it('has no return for a period longer than the bucket has existed', () => {
    expect(periodReturn(pts.slice(3), '90d', now - 20 * DAY_MS)).toBeNull();
  });

  it('reports the largest peak-to-trough fall as a negative percent', () => {
    expect(maxDrawdown(pts)).toBeCloseTo((99 / 132 - 1) * 100, 6);
    expect(maxDrawdown([{ t: 0, u: 100 }, { t: 1, u: 120 }])).toBe(0);
  });

  it('samples a period evenly for sparklines', () => {
    const s = sample(pts, 30, 3);
    expect(s[0]!.u).toBe(132);
    expect(s.at(-1)!.u).toBe(126);
  });
});

describe('contribution per holding', () => {
  const row = (unit: number, supply: number, values: Record<string, number>, prices: Record<string, number>) => ({
    unitPriceE6: usd(unit),
    supply: tok(supply),
    holdingValues: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, usd(v)])),
    prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, usd(v)])),
  });

  it('attributes price moves by value weight and sums exactly to the unit price return', () => {
    const rows = [
      row(100, 10, { A: 500, B: 500 }, { A: 10, B: 10 }),
      row(125, 10, { A: 750, B: 500 }, { A: 15, B: 10 }), // A +50%
    ];
    const c = contributions(rows);
    expect(c.A).toBeCloseTo(25, 6);
    expect(c.B).toBeCloseTo(0, 6);
  });

  it('spreads commission dilution across holdings so contributions still sum to the net return', () => {
    // A doubles (gross +50%), then settlement dilutes unit price 150 → 140.
    const rows = [
      row(100, 10, { A: 500, B: 500 }, { A: 10, B: 10 }),
      row(150, 10, { A: 1000, B: 500 }, { A: 20, B: 10 }),
      row(140, 10.714286, { A: 1000, B: 500 }, { A: 20, B: 10 }),
    ];
    const c = contributions(rows);
    expect(c.A! + c.B!).toBeCloseTo(40, 4);
    expect(c.A!).toBeGreaterThan(c.B!);
  });

  it('gives a rebalance between holdings no contribution beyond its cost', () => {
    const rows = [
      row(100, 10, { A: 500, B: 500 }, { A: 10, B: 10 }),
      row(99.9, 10, { A: 200, B: 799 }, { A: 10, B: 10 }), // sold A into B, $1 of swap cost
    ];
    const c = contributions(rows);
    expect(c.A! + c.B!).toBeCloseTo(-0.1, 6);
    expect(Math.abs(c.A!)).toBeLessThan(0.1);
  });
});
