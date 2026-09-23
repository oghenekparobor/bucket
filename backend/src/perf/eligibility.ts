/**
 * Leaderboard eligibility (product-v2 "Leaderboard eligibility", checklist 2.4). Phase 1 ranks every
 * bucket; with LEADERBOARD_ENFORCE_ELIGIBILITY=true only eligible buckets are ranked. The rule result is
 * always computed and exposed as `eligible` on bucket summaries.
 */
import { DAY_MS, type Period, periodDays } from '../util/time.js';

export const MIN_AGE_DAYS = 14;
export const MIN_CREATOR_STAKE_USD = 25;

export interface EligibilityInput {
  period: Period;
  nowMs: number;
  createdAtMs: number;
  status: 'open' | 'closed';
  /** Lowest value of the creator's own tokens over the lookback window (null if never held). */
  creatorMinStakeUsd: number | null;
  /** Tickers of current holdings that are below the liquidity floor or flagged. */
  illiquidHoldings: string[];
}

export type IneligibleReason = 'too_new' | 'younger_than_period' | 'creator_stake' | 'illiquid_holding' | 'closed';

/** Days of history the creator-stake rule looks back over: the period, or the bucket's life for "all". */
export function stakeLookbackDays(period: Period, ageDays: number): number {
  return periodDays(period) ?? ageDays;
}

export function checkEligibility(i: EligibilityInput): { eligible: boolean; reasons: IneligibleReason[] } {
  const reasons: IneligibleReason[] = [];
  const ageDays = (i.nowMs - i.createdAtMs) / DAY_MS;
  if (ageDays < MIN_AGE_DAYS) reasons.push('too_new');
  const days = periodDays(i.period);
  if (days !== null && ageDays < days) reasons.push('younger_than_period');
  if (i.creatorMinStakeUsd === null || i.creatorMinStakeUsd < MIN_CREATOR_STAKE_USD) reasons.push('creator_stake');
  if (i.illiquidHoldings.length > 0) reasons.push('illiquid_holding');
  if (i.status !== 'open') reasons.push('closed');
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Lowest USD value of the creator's own bucket tokens over the window starting at `fromMs` (or at the
 * creator's first mint, if later), sampled at each unit price point. Null if the creator never held.
 */
export function minCreatorStakeUsd(
  units: { t: number; u: number }[],
  creatorTokens: { t: number; tokens: bigint }[],
  fromMs: number,
): number | null {
  const first = creatorTokens[0];
  if (!first) return null;
  const start = Math.max(fromMs, first.t);
  let i = 0;
  let tokens = 0n;
  let min: number | null = null;
  for (const p of units) {
    while (i < creatorTokens.length && creatorTokens[i]!.t <= p.t) tokens = creatorTokens[i++]!.tokens;
    if (p.t < start) continue;
    const value = (Number(tokens) / 1e6) * p.u;
    if (min === null || value < min) min = value;
  }
  return min;
}
