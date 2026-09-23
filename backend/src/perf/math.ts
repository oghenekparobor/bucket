/**
 * Vault math used by the indexer, quotes and fixtures: thin wrappers over `math` from @bucket/sdk, which
 * mirrors programs/bucket_vault/src/math.rs exactly (bigint, floor division), so off-chain numbers match
 * what the program does. Covered by the spec's worked example in test/math.test.ts.
 */
import { DEFAULT_PARAMS as SDK_PARAMS, INITIAL_UNIT_PRICE_E6, math } from '@bucket/sdk';

export { INITIAL_UNIT_PRICE_E6 };
export const BPS = 10_000n;
export const BUCKET_TOKEN_DECIMALS = 6;

export interface ProgramParams {
  commissionBps: number; // 2000 = 20% of gains above the high-water mark
  platformShareBps: number; // 2000 = platform keeps 20% of each commission
  mintFeeBps: number; // 20 = 0.20%
  redeemFeeBps: number; // 0
}

export const DEFAULT_PARAMS: ProgramParams = {
  commissionBps: SDK_PARAMS.commissionBps,
  platformShareBps: SDK_PARAMS.platformShareBps,
  mintFeeBps: SDK_PARAMS.mintFeeBps,
  redeemFeeBps: SDK_PARAMS.redeemFeeBps,
};

export interface VaultHolding {
  mint: string;
  available: bigint; // balance - reserved, raw units
  priceE6: bigint; // per whole raw token
  decimals: number;
}

export function valueVault(holdings: VaultHolding[]): bigint {
  return holdings.reduce((sum, h) => sum + math.valueE6(h.available, h.priceE6, h.decimals), 0n);
}

/** unit_price_e6 = vault_value_e6 × 10^6 / supply; null while no tokens exist. */
export function unitPrice(vaultValueE6: bigint, supply: bigint): bigint | null {
  return supply <= 0n ? null : math.unitPriceE6(vaultValueE6, supply);
}

export interface Settlement {
  unitPriceBeforeE6: bigint;
  commissionE6: bigint;
  feeTokens: bigint;
  creatorTokens: bigint;
  platformTokens: bigint;
  supplyAfter: bigint;
  hwmAfterE6: bigint;
}

/**
 * settle_commission: if U > H, commission C = rate × (U − H) × S, paid by minting F = C × S / (V − C) new
 * tokens split creator/platform; the high-water mark moves to the post-fee unit price. Null when nothing
 * is owed.
 */
export function settleCommission(
  input: { vaultValueE6: bigint; supply: bigint; hwmE6: bigint },
  params: ProgramParams = DEFAULT_PARAMS,
): Settlement | null {
  const c = math.commission(input.vaultValueE6, input.supply, input.hwmE6, params.commissionBps);
  if (!c) return null;
  const [creatorTokens, platformTokens] = math.splitFee(c.feeTokens, params.platformShareBps);
  return {
    unitPriceBeforeE6: math.unitPriceE6(input.vaultValueE6, input.supply),
    commissionE6: c.commissionE6,
    feeTokens: c.feeTokens,
    creatorTokens,
    platformTokens,
    supplyAfter: input.supply + c.feeTokens,
    hwmAfterE6: c.hwmAfterE6,
  };
}

/** Bucket tokens issued for value added to the vault at a snapshot unit price (fill_mint). */
export function tokensForValue(valueAddedE6: bigint, unitPriceE6: bigint): bigint {
  return unitPriceE6 === 0n ? 0n : (valueAddedE6 * 1_000_000n) / unitPriceE6;
}

export interface MintSplit {
  feeE6: bigint;
  netE6: bigint;
  budgets: { mint: string; budgetE6: bigint }[];
}

/**
 * open_mint: takes the fee, then splits the net amount across legs in the vault's current value
 * proportions, or by target weights while supply is 0 (rounding dust to the largest leg).
 */
export function splitMint(
  amountE6: bigint,
  legs: { mint: string; valueE6: bigint; weightBps: number }[],
  supply: bigint,
  params: ProgramParams = DEFAULT_PARAMS,
): MintSplit {
  const feeE6 = (amountE6 * BigInt(params.mintFeeBps)) / BPS;
  const netE6 = amountE6 - feeE6;
  const useWeights = supply === 0n || legs.every((l) => l.valueE6 === 0n);
  const parts = math.splitProportional(netE6, legs.map((l) => (useWeights ? BigInt(l.weightBps) : l.valueE6)));
  return { feeE6, netE6, budgets: legs.map((l, i) => ({ mint: l.mint, budgetE6: parts[i]! })) };
}

/** Rent of a classic SPL token account (165 bytes), which the fee payer fronts for a new backer. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
/** open_mint caps the rent fee a backer repays (state.rs MAX_RENT_FEE_E6). */
export const MAX_RENT_FEE_E6 = 1_000_000n;

/** USDC a backer repays for a bucket-token account the fee payer created for them (checklist 2.3). */
export function accountRentFeeE6(solUsd: number | null): bigint {
  if (solUsd === null || !(solUsd > 0)) return 0n;
  const fee = (TOKEN_ACCOUNT_RENT_LAMPORTS * BigInt(Math.round(solUsd * 1e6))) / 1_000_000_000n;
  return fee > MAX_RENT_FEE_E6 ? MAX_RENT_FEE_E6 : fee;
}

/** redeem: quantity of each holding reserved for the redeemer, floor(available × tokens / supply). */
export function redeemShares(available: { mint: string; available: bigint }[], tokens: bigint, supply: bigint) {
  return available.map((h) => ({ mint: h.mint, qty: math.redeemQty(h.available, tokens, supply) }));
}
