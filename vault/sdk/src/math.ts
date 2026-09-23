// Mirrors programs/bucket_vault/src/math.rs exactly (bigint, floor division),
// so off-chain quotes and performance numbers match what the program does.

import { BPS, ONE_TOKEN } from './constants.js';

const pow10 = (d: number) => 10n ** BigInt(d);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Micro-dollar value of `qty` raw units at `priceE6` per whole raw token. */
export const valueE6 = (qty: bigint, priceE6: bigint, decimals: number) => (qty * priceE6) / pow10(decimals);

/** Micro-dollars per whole bucket token. */
export const unitPriceE6 = (valueE6: bigint, supply: bigint) => (supply === 0n ? 0n : (valueE6 * ONE_TOKEN) / supply);

export interface Commission {
  commissionE6: bigint;
  feeTokens: bigint;
  hwmAfterE6: bigint;
}

/** High-water-mark commission: C = rate × (U − H) × S, paid as F = C × S / (V − C) new tokens. */
export function commission(valueE6: bigint, supply: bigint, hwmE6: bigint, commissionBps: number): Commission | null {
  if (supply === 0n || commissionBps === 0) return null;
  const unit = unitPriceE6(valueE6, supply);
  if (unit <= hwmE6) return null;
  const excess = ((unit - hwmE6) * supply) / ONE_TOKEN;
  const c = (excess * BigInt(commissionBps)) / BPS;
  if (c === 0n || c >= valueE6) return null;
  const feeTokens = (c * supply) / (valueE6 - c);
  if (feeTokens === 0n) return null;
  return { commissionE6: c, feeTokens, hwmAfterE6: (valueE6 * ONE_TOKEN) / (supply + feeTokens) };
}

export const splitFee = (feeTokens: bigint, platformShareBps: number): [creator: bigint, platform: bigint] => {
  const platform = (feeTokens * BigInt(platformShareBps)) / BPS;
  return [feeTokens - platform, platform];
};

export function splitProportional(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / sum);
  const assigned = parts.reduce((a, b) => a + b, 0n);
  let maxI = 0;
  weights.forEach((w, i) => {
    if (w > weights[maxI]!) maxI = i;
  });
  parts[maxI] = parts[maxI]! + (total - assigned);
  return parts;
}

export const mintTokens = (qty: bigint, priceE6: bigint, decimals: number, spentE6: bigint, unitPrice: bigint) =>
  unitPrice === 0n ? 0n : (min(valueE6(qty, priceE6, decimals), spentE6) * ONE_TOKEN) / unitPrice;

export const withinSlippage = (valueOut: bigint, valueIn: bigint, allowedBps: number) =>
  valueOut * BPS >= valueIn * (BPS - min(BigInt(allowedBps), BPS));

export const redeemQty = (available: bigint, burn: bigint, supply: bigint) => (supply === 0n ? 0n : (available * burn) / supply);

export function clampPrice(priceE6: bigint, twapE6: bigint, maxMoveBps: number): [bigint, boolean] {
  if (twapE6 === 0n || maxMoveBps === 0) return [priceE6, false];
  const band = (twapE6 * BigInt(maxMoveBps)) / BPS;
  const lo = twapE6 > band ? twapE6 - band : 0n;
  const hi = twapE6 + band;
  if (priceE6 < lo) return [lo, true];
  if (priceE6 > hi) return [hi, true];
  return [priceE6, false];
}

// ---------- vault-level helpers ----------

export interface HoldingState {
  mint: string;
  decimals: number;
  weightBps: number;
  balance: bigint;
  reserved: bigint;
  priceE6: bigint;
  twapE6: bigint;
}

const available = (h: HoldingState) => (h.balance > h.reserved ? h.balance - h.reserved : 0n);
const conservative = (h: HoldingState) => (h.twapE6 === 0n ? h.priceE6 : min(h.priceE6, h.twapE6));

export const vaultValueE6 = (hs: HoldingState[]) => hs.reduce((a, h) => a + valueE6(available(h), h.priceE6, h.decimals), 0n);
export const vaultValueConservativeE6 = (hs: HoldingState[]) =>
  hs.reduce((a, h) => a + valueE6(available(h), conservative(h), h.decimals), 0n);

export interface MintQuote {
  feeE6: bigint;
  netE6: bigint;
  unitPriceE6: bigint;
  /** Commission that settles first, in fee tokens (dilutes before the mint). */
  pendingCommissionTokens: bigint;
  legs: { mint: string; budgetE6: bigint }[];
  /** Tokens out assuming each leg executes `swapCostBps` below reference. */
  tokensOut: bigint;
  effectivePriceE6: bigint;
}

/**
 * Quote a mint exactly as `open_mint` + `fill_mint` will run it, with an
 * assumed swap cost per leg (swap fee + issuer transfer fee + price impact).
 */
export function quoteMint(p: {
  amountE6: bigint;
  holdings: HoldingState[];
  supply: bigint;
  hwmE6: bigint;
  commissionBps: number;
  mintFeeBps: number;
  swapCostBps: number;
  /** Until the creator's first order fills, budgets follow target weights. */
  creatorFunded?: boolean;
}): MintQuote {
  let supply = p.supply;
  const c = commission(vaultValueConservativeE6(p.holdings), supply, p.hwmE6, p.commissionBps);
  let hwm = p.hwmE6;
  if (c) {
    supply += c.feeTokens;
    hwm = c.hwmAfterE6;
  }
  const feeE6 = (p.amountE6 * BigInt(p.mintFeeBps)) / BPS;
  const netE6 = p.amountE6 - feeE6;
  const value = vaultValueE6(p.holdings);
  const empty = supply === 0n || (value === 0n && supply <= 1_000n);
  const unit = empty ? hwm : unitPriceE6(value, supply);
  const weights =
    empty || p.creatorFunded === false
      ? p.holdings.map((h) => BigInt(h.weightBps))
      : p.holdings.map((h) => valueE6(available(h), h.priceE6, h.decimals));
  const budgets = splitProportional(netE6, weights);
  const keep = BPS - BigInt(p.swapCostBps);
  const tokensOut = budgets.reduce((a, b) => a + (((b * keep) / BPS) * ONE_TOKEN) / (unit || 1n), 0n);
  return {
    feeE6,
    netE6,
    unitPriceE6: unit,
    pendingCommissionTokens: c?.feeTokens ?? 0n,
    legs: p.holdings.map((h, i) => ({ mint: h.mint, budgetE6: budgets[i]! })),
    tokensOut,
    effectivePriceE6: tokensOut === 0n ? 0n : (p.amountE6 * ONE_TOKEN) / tokensOut,
  };
}

export interface RedeemQuote {
  burn: bigint;
  feeTokens: bigint;
  legs: { mint: string; qty: bigint; valueE6: bigint }[];
  usdcOutE6: bigint;
  unitPriceE6: bigint;
  effectivePriceE6: bigint;
}

/** Quote a redeem: pro-rata slice of every holding, sold with an assumed cost. */
export function quoteRedeem(p: {
  tokens: bigint;
  holdings: HoldingState[];
  supply: bigint;
  hwmE6: bigint;
  commissionBps: number;
  redeemFeeBps: number;
  swapCostBps: number;
}): RedeemQuote {
  let supply = p.supply;
  const c = commission(vaultValueConservativeE6(p.holdings), supply, p.hwmE6, p.commissionBps);
  if (c) supply += c.feeTokens;
  const feeTokens = (p.tokens * BigInt(p.redeemFeeBps)) / BPS;
  const burn = p.tokens - feeTokens;
  const keep = BPS - BigInt(p.swapCostBps);
  const legs = p.holdings.map((h) => {
    // slices worth under a cent stay with the remaining holders, as on-chain
    const raw = redeemQty(available(h), burn, supply);
    const qty = valueE6(raw, h.priceE6, h.decimals) < 10_000n ? 0n : raw;
    return { mint: h.mint, qty, valueE6: valueE6(qty, h.priceE6, h.decimals) };
  });
  const gross = legs.reduce((a, l) => a + l.valueE6, 0n);
  const usdcOutE6 = (gross * keep) / BPS;
  return {
    burn,
    feeTokens,
    legs,
    usdcOutE6,
    unitPriceE6: unitPriceE6(vaultValueE6(p.holdings), supply),
    effectivePriceE6: p.tokens === 0n ? 0n : (usdcOutE6 * ONE_TOKEN) / p.tokens,
  };
}
