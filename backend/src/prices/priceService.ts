/**
 * Price service: on-chain token price for every catalog token from Jupiter price v3 (per whole raw
 * token, i.e. before the Token-2022 scaled-UI multiplier, plus the UI price wallets show). Issuer mark
 * prices for pre-IPO tokens are written by the catalog sync from PreStocks / Tessera.
 */
import type { Queryable } from '../db/pool.js';
import { recordHealth } from '../catalog/repo.js';
import { SOL_MINT, fetchPrices, rawPrice } from '../catalog/sources/jupiter.js';
import { chunk, mapLimit } from '../util/concurrency.js';

const toE6 = (usd: number) => BigInt(Math.round(usd * 1e6)).toString();

export async function syncPrices(db: Queryable, now = new Date()): Promise<{ priced: number; missing: string[]; solUsd: number | null }> {
  const assets = await db.query<{ mint: string }>(`SELECT mint FROM assets WHERE mirror_of IS NULL AND source_payload IS NOT NULL`);
  const mints = [...assets.rows.map((r) => r.mint), SOL_MINT];
  const results = await mapLimit(chunk(mints, 50), 2, (batch) => fetchPrices(batch));

  const failed = results.filter((r) => !r.ok);
  await recordHealth(db, {
    source: 'jupiter-price',
    ok: failed.length === 0,
    statusCode: failed[0]?.status ?? results[0]?.status ?? null,
    latencyMs: Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / Math.max(1, results.length)),
    itemCount: results.reduce((a, r) => a + Object.values(r.data ?? {}).filter(Boolean).length, 0),
    error: failed[0]?.error ?? null,
  });

  const ts = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  let priced = 0;
  let solUsd: number | null = null;
  const seen = new Set<string>();
  for (const r of results) {
    for (const [mint, p] of Object.entries(r.data ?? {})) {
      if (!p || !(p.usdPrice > 0)) continue;
      seen.add(mint);
      if (mint === SOL_MINT) {
        solUsd = p.usdPrice;
        await db.query(
          `INSERT INTO kv (key, value, updated_at) VALUES ('sol_price_usd', $1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [JSON.stringify(p.usdPrice), now],
        );
        continue;
      }
      const { uiPrice, rawPrice: raw, multiplier } = rawPrice(p, now.getTime());
      await db.query(
        `UPDATE assets SET price_e6 = $2, ui_price_e6 = $3, ui_multiplier = $4, price_updated_at = $5,
           liquidity_usd = COALESCE($6, liquidity_usd), updated_at = now() WHERE mint = $1`,
        [mint, toE6(raw), toE6(uiPrice), multiplier, now, p.liquidity ?? null],
      );
      await db.query(
        `INSERT INTO asset_prices (mint, kind, ts, price_e6, ui_price_e6) VALUES ($1, 'onchain', $2, $3, $4)
         ON CONFLICT (mint, kind, ts) DO UPDATE SET price_e6 = EXCLUDED.price_e6, ui_price_e6 = EXCLUDED.ui_price_e6`,
        [mint, ts, toE6(raw), toE6(uiPrice)],
      );
      priced++;
    }
  }
  return { priced, missing: mints.filter((m) => m !== SOL_MINT && !seen.has(m)), solUsd };
}
