/**
 * Daily Jupiter quote probe over catalog tokens: stores minimum tradeable size and depth under the
 * price-impact bound on each asset (feeds eligibility when REQUIRE_QUOTE_PROBE=true, and mint quotes).
 */
import { type Config, config } from '../config.js';
import type { Db } from '../db/pool.js';
import { recomputeEligibility, recordHealth } from '../catalog/repo.js';
import { probeMint, type ProbeResult } from '../catalog/routingProbe.js';
import { eligibilityRules } from './catalogSync.js';

export async function runRoutingProbe(
  db: Db,
  opts: { minLiquidityUsd?: number; depth?: boolean; onResult?: (mint: string, r: ProbeResult) => void } = {},
  cfg: Config = config,
) {
  const rows = await db.query<{ mint: string; decimals: number; price_e6: string }>(
    `SELECT mint, decimals, price_e6 FROM assets
     WHERE source_payload IS NOT NULL AND price_e6 IS NOT NULL AND COALESCE(liquidity_usd, 0) >= $1 ORDER BY liquidity_usd DESC NULLS LAST`,
    [opts.minLiquidityUsd ?? 0],
  );
  let routed = 0;
  let failedQuotes = 0;
  let quotes = 0;
  let latency = 0;
  for (const row of rows.rows) {
    const started = performance.now();
    const result = await probeMint(row.mint, row.decimals, Number(row.price_e6) / 1e6, { maxImpactPct: cfg.MAX_PRICE_IMPACT_PCT, depth: opts.depth ?? true });
    latency += performance.now() - started;
    quotes += result.samples.length;
    failedQuotes += result.samples.filter((s) => !s.ok && s.error && !/no route|COULD_NOT_FIND|TOKEN_NOT_TRADABLE/i.test(s.error)).length;
    if (result.minTradeUsd !== null) routed++;
    await db.query(
      `UPDATE assets SET min_trade_usd = $2, depth_1pct_usd = $3, probe = $4, probed_at = now() WHERE mint = $1`,
      [row.mint, result.minTradeUsd, result.depthUsd, JSON.stringify(result.samples)],
    );
    opts.onResult?.(row.mint, result);
  }
  await recordHealth(db, {
    source: 'jupiter-quote',
    ok: failedQuotes === 0,
    statusCode: null,
    latencyMs: Math.round(latency / Math.max(1, quotes)),
    itemCount: quotes,
    error: failedQuotes ? `${failedQuotes} quote requests failed` : null,
  });
  await recomputeEligibility(db, eligibilityRules(cfg));
  return { probed: rows.rows.length, routed, quotes };
}
