/**
 * Rebuilds a bucket's unit price at fixed time steps from its event-derived logs (vault balances,
 * supply, high-water mark) and the price series of its holdings. Pure: no I/O.
 */
import { valueE6 } from '../util/money.js';
import { HOUR_MS } from '../util/time.js';
import { INITIAL_UNIT_PRICE_E6, unitPrice } from './math.js';

export interface BalanceEntry { ts: number; mint: string; balance: bigint; reserved: bigint }
export interface SupplyEntry { ts: number; supply: bigint }
export interface HwmEntry { ts: number; hwmE6: bigint }
export interface PriceEntry { ts: number; priceE6: bigint }

export interface BucketHistory {
  decimals: Record<string, number>;
  balances: BalanceEntry[]; // sorted by ts
  supplies: SupplyEntry[]; // sorted by ts
  hwms: HwmEntry[]; // sorted by ts
  prices: Record<string, PriceEntry[]>; // per mint, sorted by ts
}

export interface SeriesPoint {
  t: number;
  unitPriceE6: bigint;
  vaultValueE6: bigint;
  supply: bigint;
  hwmE6: bigint;
  holdingValues: Record<string, bigint>;
  prices: Record<string, bigint>;
}

/** Cursor that walks a sorted log forward, applying every entry with ts ≤ t. */
function cursor<T extends { ts: number }>(entries: T[], apply: (e: T) => void) {
  let i = 0;
  return (t: number) => {
    while (i < entries.length && entries[i]!.ts <= t) apply(entries[i++]!);
  };
}

/**
 * State at each time in `times` (ascending). Points with zero supply, or where a held mint has no price
 * yet, are skipped rather than reported as a bogus value.
 */
export function computeSeries(h: BucketHistory, times: number[]): SeriesPoint[] {
  const balances = new Map<string, { balance: bigint; reserved: bigint }>();
  const prices = new Map<string, bigint>();
  let supply = 0n;
  let hwm = INITIAL_UNIT_PRICE_E6;

  const advanceBalances = cursor(h.balances, (e) => balances.set(e.mint, { balance: e.balance, reserved: e.reserved }));
  const advanceSupply = cursor(h.supplies, (e) => (supply = e.supply));
  const advanceHwm = cursor(h.hwms, (e) => (hwm = e.hwmE6));
  const advancePrices = Object.entries(h.prices).map(([mint, series]) => cursor(series, (e) => prices.set(mint, e.priceE6)));

  const out: SeriesPoint[] = [];
  for (const t of times) {
    advanceBalances(t);
    advanceSupply(t);
    advanceHwm(t);
    for (const advance of advancePrices) advance(t);
    if (supply <= 0n) continue;

    let vault = 0n;
    let missingPrice = false;
    const holdingValues: Record<string, bigint> = {};
    const pointPrices: Record<string, bigint> = {};
    for (const [mint, b] of balances) {
      const available = b.balance - b.reserved;
      const price = prices.get(mint);
      if (price === undefined) {
        if (available > 0n) missingPrice = true;
        continue;
      }
      const v = valueE6(available, price, h.decimals[mint] ?? 0);
      holdingValues[mint] = v;
      pointPrices[mint] = price;
      vault += v;
    }
    if (missingPrice) continue;
    out.push({ t, unitPriceE6: unitPrice(vault, supply)!, vaultValueE6: vault, supply, hwmE6: hwm, holdingValues, prices: pointPrices });
  }
  return out;
}

/** Hour boundaries from the hour containing `fromMs` through the hour containing `toMs`. */
export function hourlyTimes(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(fromMs / HOUR_MS) * HOUR_MS; t <= toMs; t += HOUR_MS) out.push(t);
  return out;
}
