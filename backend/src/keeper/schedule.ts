/**
 * settle_commission timing (checklist 2.5: "settlement at unpredictable times"): each bucket settles at a
 * uniformly random moment between 12 and 24 hours after its last settlement, so it happens at least
 * daily but nobody can predict the minute to pump a thin holding into.
 */
import { randomInt } from 'node:crypto';
import { HOUR_MS } from '../util/time.js';

export const MIN_GAP_MS = 12 * HOUR_MS;
export const MAX_GAP_MS = 24 * HOUR_MS;
const OVERDUE_JITTER_MS = 30 * 60_000;

/** `rand` returns an integer in [0, n). Defaults to a CSPRNG. */
export function nextSettleAt(lastSettledMs: number, nowMs: number, rand: (n: number) => number = randomInt): number {
  const candidate = lastSettledMs + MIN_GAP_MS + rand(MAX_GAP_MS - MIN_GAP_MS);
  if (candidate > nowMs) return candidate;
  // Overdue (keeper was down, or a new bucket created long ago): settle soon, still with jitter.
  return nowMs + rand(OVERDUE_JITTER_MS);
}
