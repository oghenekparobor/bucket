/**
 * Rebalance planning (phase 2): trades that move the vault from its current value proportions toward the
 * active target weights, always selling an over-weight holding into an under-weight one, with a minimum
 * output enforcing the slippage bound (the program re-checks both).
 */
import { BPS } from '../perf/math.js';
import { pow10, valueE6 } from '../util/money.js';

export interface RebalanceHolding {
  mint: string;
  available: bigint; // raw units
  priceE6: bigint; // per whole raw token
  decimals: number;
  weightBps: number; // target (0 for a holding being removed)
}

export interface PlannedTrade {
  fromMint: string;
  toMint: string;
  qtyIn: bigint; // raw units of fromMint
  valueE6: bigint;
  minOut: bigint; // raw units of toMint
}

/**
 * Greedy pairing of the largest excess with the largest shortfall, so each trade is at most
 * min(seller's excess, buyer's shortfall) and a sell-down is split across several buyers, as the program
 * requires. Deviations under `toleranceBps` of vault value are left alone so dust never generates
 * trades. `marginBps` shrinks each trade so it stays inside the program's bounds, which it measures
 * against the last settled vault value rather than the prices used here.
 */
export function planRebalance(holdings: RebalanceHolding[], slippageBps: number, toleranceBps = 50, marginBps = 0): PlannedTrade[] {
  const values = holdings.map((h) => valueE6(h.available, h.priceE6, h.decimals));
  const total = values.reduce((a, b) => a + b, 0n);
  if (total === 0n) return [];
  const tolerance = (total * BigInt(toleranceBps)) / BPS;
  const deltas = holdings.map((h, i) => ({ h, delta: values[i]! - (total * BigInt(h.weightBps)) / BPS }));
  const over = deltas.filter((d) => d.delta > tolerance).sort((a, b) => Number(b.delta - a.delta));
  const under = deltas.filter((d) => -d.delta > tolerance).sort((a, b) => Number(a.delta - b.delta));

  const trades: PlannedTrade[] = [];
  let i = 0;
  let j = 0;
  while (i < over.length && j < under.length) {
    const from = over[i]!;
    const to = under[j]!;
    const amount = from.delta < -to.delta ? from.delta : -to.delta;
    const traded = (amount * (BPS - BigInt(marginBps))) / BPS;
    const qtyIn = (traded * pow10(from.h.decimals)) / from.h.priceE6;
    const expectedOut = (traded * pow10(to.h.decimals)) / to.h.priceE6;
    trades.push({
      fromMint: from.h.mint,
      toMint: to.h.mint,
      qtyIn,
      valueE6: traded,
      minOut: (expectedOut * (BPS - BigInt(slippageBps))) / BPS,
    });
    from.delta -= amount;
    to.delta += amount;
    if (from.delta <= tolerance) i++;
    if (-to.delta <= tolerance) j++;
  }
  return trades;
}
