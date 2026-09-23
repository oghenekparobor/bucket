/**
 * Catalog sync (hourly): pulls xStocks (Jupiter search), PreStocks and Tessera, merges them into
 * `assets`, flags tokens that disappeared, refreshes prices and recomputes eligibility.
 */
import { type Config, config } from '../config.js';
import { type Db, withTx } from '../db/pool.js';
import { fetchPreStocksSource, fetchTesseraSource, fetchXStocks, type HealthSink } from '../catalog/fetch.js';
import { planCatalogMerge } from '../catalog/merge.js';
import { applyFlagChanges, loadExistingAssets, recomputeEligibility, recordHealth, upsertSourceTokens } from '../catalog/repo.js';
import { syncPrices } from '../prices/priceService.js';

export function eligibilityRules(cfg: Config = config) {
  return { floorUsd: cfg.LIQUIDITY_FLOOR_USD, requireQuoteProbe: cfg.REQUIRE_QUOTE_PROBE, maxMinTradeUsd: cfg.MAX_MIN_TRADE_USD };
}

export async function runCatalogSync(db: Db, now = new Date(), cfg: Config = config) {
  const existing = await loadExistingAssets(db);
  const health: HealthSink = (h) => recordHealth(db, h);
  const knownXStocks = existing.filter((e) => e.source === 'xStocks').map((e) => ({ mint: e.mint, ticker: e.ticker }));
  const fetches = await Promise.all([fetchXStocks(knownXStocks, health), fetchPreStocksSource(health), fetchTesseraSource(health)]);
  const plan = planCatalogMerge(existing, fetches);
  await withTx(db, async (c) => {
    await upsertSourceTokens(c, plan.upserts, now);
    await applyFlagChanges(c, plan, now);
  });
  const prices = await syncPrices(db, now);
  const eligibility = await recomputeEligibility(db, eligibilityRules(cfg));
  return {
    sources: fetches.map((f) => ({ source: f.source, ok: f.ok, tokens: f.tokens.length, error: f.error ?? null })),
    flagged: plan.flag.map((f) => f.mint),
    unflagged: plan.unflag,
    partialSources: plan.partialSources,
    priced: prices.priced,
    unpriced: prices.missing.length,
    eligible: eligibility.eligible,
    total: eligibility.total,
  };
}

/** Price refresh between catalog syncs (every few minutes). */
export async function runPriceSync(db: Db, now = new Date(), cfg: Config = config) {
  const prices = await syncPrices(db, now);
  const eligibility = await recomputeEligibility(db, eligibilityRules(cfg));
  return { priced: prices.priced, unpriced: prices.missing.length, eligible: eligibility.eligible };
}
