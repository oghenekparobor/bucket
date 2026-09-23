/** Recipe diffs, shared by version history, the pending-edit banner and edit notifications. */

export interface WeightEntry {
  mint: string;
  weight_bps: number;
}

export interface WeightDiff {
  mint: string;
  fromPct: number | null;
  toPct: number | null;
}

/** Union of both recipes in "to" order, then removed holdings; weights in whole percent. */
export function diffHoldings(from: WeightEntry[], to: WeightEntry[]): WeightDiff[] {
  const before = new Map(from.map((h) => [h.mint, h.weight_bps / 100]));
  const after = new Map(to.map((h) => [h.mint, h.weight_bps / 100]));
  const rows: WeightDiff[] = to.map((h) => ({ mint: h.mint, fromPct: before.get(h.mint) ?? null, toPct: h.weight_bps / 100 }));
  for (const h of from) if (!after.has(h.mint)) rows.push({ mint: h.mint, fromPct: h.weight_bps / 100, toPct: null });
  return rows;
}

/** "NVDAx 30% → 25%, added tSTRIPE at 15%, removed COINx (was 10%)"; the first version lists its recipe. */
export function changeSummary(from: WeightEntry[] | null, to: WeightEntry[], ticker: (mint: string) => string): string {
  if (!from) return 'Created: ' + to.map((h) => `${ticker(h.mint)} ${h.weight_bps / 100}%`).join(', ');
  const parts: string[] = [];
  for (const d of diffHoldings(from, to)) {
    if (d.fromPct === null) parts.push(`added ${ticker(d.mint)} at ${d.toPct}%`);
    else if (d.toPct === null) parts.push(`removed ${ticker(d.mint)} (was ${d.fromPct}%)`);
    else if (d.fromPct !== d.toPct) parts.push(`${ticker(d.mint)} ${d.fromPct}% → ${d.toPct}%`);
  }
  if (parts.length === 0) return 'No weight changes';
  // Capitalize a leading verb only; tickers keep their case (pANTHROPIC, tSTRIPE).
  const text = parts.join(', ');
  return /^(added|removed) /.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
