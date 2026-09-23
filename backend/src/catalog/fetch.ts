/**
 * Fetches each issuer source into SourceTokens and reports per-source health (status code, latency,
 * errors) so upstream uptime can be tracked (the Tessera uptime question in product-v2).
 */
import { chunk, mapLimit } from '../util/concurrency.js';
import type { FetchResult } from '../util/http.js';
import { fromPreStock, fromTessera, fromXStock } from './classify.js';
import { type JupToken, lookupMints, searchTokens } from './sources/jupiter.js';
import { fetchPreStocks } from './sources/prestocks.js';
import { fetchTessera } from './sources/tessera.js';
import type { SourceFetch } from './types.js';
import { XSTOCK_TAG, XSTOCKS_TICKERS } from './xstocks.js';

export interface HealthRecord {
  source: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  itemCount: number | null;
  error: string | null;
}

export type HealthSink = (h: HealthRecord) => Promise<void>;

function toHealth(source: string, r: FetchResult<unknown>, itemCount: number | null): HealthRecord {
  return { source, ok: r.ok, statusCode: r.status, latencyMs: r.latencyMs, itemCount, error: r.error };
}

/** Aggregates many Jupiter search calls into one health record. */
function aggregate(source: string, results: FetchResult<unknown>[], itemCount: number): HealthRecord {
  const failed = results.filter((r) => !r.ok);
  const latency = results.reduce((a, r) => a + r.latencyMs, 0) / Math.max(1, results.length);
  return {
    source,
    ok: failed.length === 0,
    statusCode: failed[0]?.status ?? results[0]?.status ?? null,
    latencyMs: Math.round(latency),
    itemCount,
    error: failed.length ? `${failed.length}/${results.length} requests failed: ${failed[0]?.error}` : null,
  };
}

/** Jupiter metadata for a list of mints (batched by 50). */
export async function jupiterLookup(mints: string[]): Promise<{ tokens: Map<string, JupToken>; results: FetchResult<JupToken[]>[] }> {
  const results = await mapLimit(chunk(mints, 50), 2, (batch) => lookupMints(batch));
  const tokens = new Map<string, JupToken>();
  for (const r of results) for (const t of r.data ?? []) tokens.set(t.id, t);
  return { tokens, results };
}

/**
 * xStocks: the generic "xStock" query plus one query per maintained ticker not already in the catalog
 * (discovery), then every known mint re-checked by address in batches of 50 (presence).
 */
export async function fetchXStocks(known: { mint: string; ticker: string }[], health: HealthSink): Promise<SourceFetch> {
  const knownTickers = new Set(known.map((k) => k.ticker));
  const knownMints = known.map((k) => k.mint);
  const queries = ['xStock', ...XSTOCKS_TICKERS.map((t) => `${t}x`).filter((t) => !knownTickers.has(t))];
  const searchResults = await mapLimit(queries, 2, (q) => searchTokens(q));
  const found = new Map<string, JupToken>();
  for (const r of searchResults) for (const t of r.data ?? []) if (t.tags?.includes(XSTOCK_TAG)) found.set(t.id, t);
  // Re-check known mints by address so ranking changes in search never make a token look delisted.
  const recheck = knownMints.filter((m) => !found.has(m));
  const lookup = recheck.length ? await jupiterLookup(recheck) : { tokens: new Map<string, JupToken>(), results: [] };
  for (const t of lookup.tokens.values()) if (t.tags?.includes(XSTOCK_TAG)) found.set(t.id, t);

  const all = [...searchResults, ...lookup.results];
  await health(aggregate('jupiter-search', all, found.size));
  const failedShare = all.filter((r) => !r.ok).length / Math.max(1, all.length);
  const ok = searchResults[0]?.ok === true && failedShare < 0.5;
  return { source: 'xStocks', ok, tokens: [...found.values()].map(fromXStock), error: ok ? undefined : 'jupiter search failing' };
}

export async function fetchPreStocksSource(health: HealthSink): Promise<SourceFetch> {
  const r = await fetchPreStocks();
  const rows = Array.isArray(r.data) ? r.data.filter((p) => p?.contract_address && p.symbol) : [];
  await health(toHealth('prestocks', r, r.ok ? rows.length : null));
  if (!r.ok) return { source: 'PreStocks', ok: false, tokens: [], error: r.error ?? 'failed' };
  const { tokens } = await jupiterLookup(rows.map((p) => p.contract_address));
  return { source: 'PreStocks', ok: true, tokens: rows.map((p) => fromPreStock(p, tokens.get(p.contract_address))) };
}

export async function fetchTesseraSource(health: HealthSink): Promise<SourceFetch> {
  const r = await fetchTessera();
  const rows = Array.isArray(r.data) ? r.data.filter((t) => t?.mint && t.code) : [];
  await health(toHealth('tessera', r, r.ok ? rows.length : null));
  if (!r.ok) return { source: 'Tessera', ok: false, tokens: [], error: r.error ?? 'failed' };
  const { tokens } = await jupiterLookup(rows.map((t) => t.mint));
  return { source: 'Tessera', ok: true, tokens: rows.map((t) => fromTessera(t, tokens.get(t.mint))) };
}
