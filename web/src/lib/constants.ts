/** Fixed product terms (spec + Config defaults in architecture §2.1). */
export const COMMISSION_PCT = 20;
/** Share of each commission kept by Bucket; the creator gets the rest (80%). */
export const PLATFORM_SHARE_PCT = 20;
export const CREATOR_SHARE_PCT = 100 - PLATFORM_SHARE_PCT;
/** Config.mint_fee_bps = 20. */
export const MINT_FEE_PCT = 0.2;
/** The commission sentence used wherever commission is explained (docs/legal/terms-of-service.md §fees). */
export const COMMISSION_SPLIT_TEXT = `paid in newly minted tokens: ${100 - PLATFORM_SHARE_PCT}% to the creator, ${PLATFORM_SHARE_PCT}% to Bucket`;
export const MIN_DEPOSIT_USD = 1;
export const MIN_CREATOR_STAKE_USD = 25;
export const MIN_HOLDINGS = 2;
export const MAX_HOLDINGS = 15;
export const MIN_WEIGHT_PCT = 2;
export const MAX_WEIGHT_PUBLIC_PCT = 50;
export const MAX_WEIGHT_PRE_IPO_PCT = 25;
export const MAX_ACTIVE_BUCKETS = 5;
export const SLIPPAGE_PCT = 1;
export const THESIS_MAX = 280;
export const NAME_MAX_BYTES = 48;
export const EDIT_NOTE_MAX = 140;

/** Dollar example used across the app: total commission (creator + Bucket) on a 20% rise on $X. */
export function commissionExample(amountUsd: number, risePct = 20): number {
  return amountUsd * (risePct / 100) * (COMMISSION_PCT / 100);
}
