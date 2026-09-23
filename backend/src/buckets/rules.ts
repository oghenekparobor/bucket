/**
 * Recipe rules the program enforces on create_bucket and propose_edit (docs/architecture.md §2.2,
 * product-v2 "Create a bucket"), checked here first so users get a clear error before signing.
 */
import { maxWeightPct } from '../catalog/eligibility.js';
import { byteLength } from '../util/sanitize.js';

export const MIN_HOLDINGS = 2;
export const MAX_HOLDINGS = 15;
export const MIN_WEIGHT_PCT = 2;
export const MAX_ACTIVE_BUCKETS = 5;
export const NAME_MAX_BYTES = 48;
export const THESIS_MAX_BYTES = 280;
export const NOTE_MAX_BYTES = 140;
export const EDIT_COOLDOWN_DAYS = 7;

export interface RecipeAsset {
  ticker: string;
  assetType: string;
  eligible: boolean;
  flagged: boolean;
}

export function validateRecipe(holdings: { mint: string; weightPct: number }[], assets: Map<string, RecipeAsset>): string[] {
  const errors: string[] = [];
  if (holdings.length < MIN_HOLDINGS || holdings.length > MAX_HOLDINGS) {
    errors.push(`A bucket holds ${MIN_HOLDINGS} to ${MAX_HOLDINGS} tokens (got ${holdings.length})`);
  }
  if (new Set(holdings.map((h) => h.mint)).size !== holdings.length) errors.push('Each token can appear once');
  let sum = 0;
  for (const h of holdings) {
    sum += h.weightPct;
    const a = assets.get(h.mint);
    if (!a) {
      errors.push(`${h.mint} is not in the catalog`);
      continue;
    }
    if (!Number.isInteger(h.weightPct)) errors.push(`${a.ticker}: weights are whole percentages`);
    const cap = maxWeightPct(a.assetType);
    if (h.weightPct < MIN_WEIGHT_PCT || h.weightPct > cap) errors.push(`${a.ticker}: weight must be ${MIN_WEIGHT_PCT}% to ${cap}%`);
    if (a.flagged) errors.push(`${a.ticker} is flagged for review and cannot be added`);
    else if (!a.eligible) errors.push(`${a.ticker} is below the liquidity floor`);
  }
  if (sum !== 100) errors.push(`Weights must sum to 100% (got ${sum}%)`);
  return errors;
}

export function validateText(name: string, thesis: string): string[] {
  const errors: string[] = [];
  if (!name.trim()) errors.push('Name is required');
  if (byteLength(name) > NAME_MAX_BYTES) errors.push(`Name is at most ${NAME_MAX_BYTES} bytes`);
  if (byteLength(thesis) > THESIS_MAX_BYTES) errors.push(`Thesis is at most ${THESIS_MAX_BYTES} bytes`);
  return errors;
}
