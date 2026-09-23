/**
 * Pure catalog merge plan. A token that disappears from a successful fetch of its source is flagged
 * (blocked from new buckets) and kept; it is never deleted. Flags raised for disappearance clear
 * automatically if the token comes back; every flag change is audited for review. A failed or
 * suspiciously partial fetch (under half the known tokens) never flags anything.
 */
import type { Source, SourceFetch, SourceToken } from './types.js';

export const MISSING_REASON = 'missing_from_source';

export interface ExistingAsset {
  mint: string;
  ticker: string;
  source: Source;
  flagged: boolean;
  flagReason: string | null;
  fixture: boolean;
}

export interface MergePlan {
  upserts: SourceToken[];
  flag: { mint: string; reason: string }[];
  unflag: string[];
  partialSources: Source[];
}

export function planCatalogMerge(existing: ExistingAsset[], fetches: SourceFetch[]): MergePlan {
  const plan: MergePlan = { upserts: [], flag: [], unflag: [], partialSources: [] };
  const bySource = new Map<Source, ExistingAsset[]>();
  for (const e of existing) {
    if (e.fixture) continue; // local fixture tokens have no upstream source
    bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
  }
  const existingByMint = new Map(existing.map((e) => [e.mint, e]));

  for (const f of fetches) {
    if (!f.ok) continue;
    const seen = new Set(f.tokens.map((t) => t.mint));
    plan.upserts.push(...f.tokens);
    for (const t of f.tokens) {
      const prev = existingByMint.get(t.mint);
      if (prev?.flagged && prev.flagReason === MISSING_REASON) plan.unflag.push(t.mint);
    }
    const known = bySource.get(f.source) ?? [];
    if (known.length > 0 && f.tokens.length < known.length / 2) {
      plan.partialSources.push(f.source);
      continue;
    }
    for (const e of known) {
      if (!seen.has(e.mint) && !e.flagged) plan.flag.push({ mint: e.mint, reason: MISSING_REASON });
    }
  }
  return plan;
}
