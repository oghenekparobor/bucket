/**
 * Performance statistics over a unit price series (product-v2 "Performance and leaderboard methodology").
 * Returns are after commission because they are computed on unit price, which fee tokens dilute.
 */
import { DAY_MS, HOUR_MS, type Period, periodDays } from '../util/time.js';

export interface UnitPoint {
  t: number; // ms
  u: number; // unit price in dollars
}

const INITIAL_UNIT_PRICE = 100;

/**
 * Percent change in unit price over the period ending at the last point. "all" measures from the $100
 * launch price. A bucket younger than the period has no return for it (null).
 */
export function periodReturn(points: UnitPoint[], period: Period, createdAtMs: number): number | null {
  const last = points.at(-1);
  if (!last) return null;
  const days = periodDays(period);
  if (days === null) return (last.u / INITIAL_UNIT_PRICE - 1) * 100;
  const start = last.t - days * DAY_MS;
  if (createdAtMs > start + HOUR_MS) return null;
  let ref: UnitPoint | undefined;
  for (const p of points) {
    if (p.t > start) break;
    ref = p;
  }
  // No point before the window start (e.g. first fill came an hour after creation): use the first point.
  ref ??= points[0];
  if (!ref || ref.u <= 0) return null;
  return (last.u / ref.u - 1) * 100;
}

/** Largest peak-to-trough fall, as a negative percent (0 when the price never fell below a prior high). */
export function maxDrawdown(points: UnitPoint[]): number {
  let peak = INITIAL_UNIT_PRICE;
  let worst = 0;
  for (const p of points) {
    if (p.u > peak) peak = p.u;
    const dd = (p.u / peak - 1) * 100;
    if (dd < worst) worst = dd;
  }
  return worst;
}

export interface ContributionRow {
  supply: bigint;
  holdingValues: Record<string, bigint>;
  prices: Record<string, bigint>;
  unitPriceE6: bigint;
}

/**
 * Contribution of each holding to the unit price return over `rows` (ascending, first row = period
 * start), in percentage points. Per step, a holding contributes its value per bucket token times its
 * price return; whatever else moved unit price in that step (commission dilution, swap and rebalance
 * costs) is shared across holdings by value weight. A rebalance moving value between holdings therefore
 * contributes only its cost, and the contributions sum exactly to the unit price return.
 */
export function contributions(rows: ContributionRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const first = rows[0];
  if (!first || first.unitPriceE6 <= 0n) return out;
  const start = Number(first.unitPriceE6) / 1e6;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    if (prev.supply <= 0n) continue;
    const vault = Object.values(prev.holdingValues).reduce((a, v) => a + Number(v), 0);
    if (vault <= 0) continue;
    const step: Record<string, number> = {};
    let priceDriven = 0;
    for (const [mint, value] of Object.entries(prev.holdingValues)) {
      const p0 = prev.prices[mint];
      const p1 = cur.prices[mint];
      const perToken = Number(value) / Number(prev.supply); // dollars per bucket token
      const move = p0 && p1 && p0 > 0n ? perToken * (Number(p1) / Number(p0) - 1) : 0;
      step[mint] = move;
      priceDriven += move;
    }
    const residual = (Number(cur.unitPriceE6) - Number(prev.unitPriceE6)) / 1e6 - priceDriven;
    for (const [mint, value] of Object.entries(prev.holdingValues)) {
      const total = step[mint]! + residual * (Number(value) / vault);
      out[mint] = (out[mint] ?? 0) + (total * 100) / start;
    }
  }
  return out;
}

/** `n` evenly spaced samples of the series within the last `days` (whole series for null). */
export function sample(points: UnitPoint[], days: number | null, n: number): UnitPoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const from = days === null ? points[0]!.t : last.t - days * DAY_MS;
  const window = points.filter((p) => p.t >= from);
  if (window.length <= n) return window;
  const out: UnitPoint[] = [];
  for (let i = 0; i < n; i++) out.push(window[Math.round((i * (window.length - 1)) / (n - 1))]!);
  return out;
}

/** Chart resolution per period: hourly for 7d, 4h for 30d, 12h for 90d, daily (or coarser) for all. */
export function chartStepMs(period: Period, spanMs: number): number {
  switch (period) {
    case '7d':
      return HOUR_MS;
    case '30d':
      return 4 * HOUR_MS;
    case '90d':
      return 12 * HOUR_MS;
    case 'all':
      return Math.max(DAY_MS, Math.ceil(spanMs / 240 / HOUR_MS) * HOUR_MS);
  }
}
