/**
 * Price pusher. Every allow-listed Asset gets price_raw = price_ui × the scaled-UI multiplier in force
 * (per whole raw token, docs/architecture.md §1), from Jupiter price v3 via the price service. Off
 * mainnet each mock mint gets the UI price of the mainnet token it mirrors: mocks carry no scaled-UI
 * extension (multiplier 1), so one mock token stands for one token as wallets and issuers show it, and
 * that is also the price vault/scripts/setup.ts listed them at. Written to its Asset account and its
 * mock_swap market in the same transaction. Prices go stale on-chain after
 * max_price_age_secs (3600) and a stale price blocks mints, so this runs every few minutes even when
 * prices have not moved. The program clamps each push to ±max_price_move_bps of its TWAP.
 */
import type { ChainGateway } from '../chain/gateway.js';
import type { Deployment } from '../chain/deployment.js';
import type { Queryable } from '../db/pool.js';
import { normalizeAssetType, normalizeSource } from '../indexer/events.js';
import { big } from '../util/money.js';

/** Points devnet/localnet mock mints at the mainnet token they mirror, from the deployment record. */
export async function syncDeploymentMirrors(db: Queryable, deployment: Deployment | null): Promise<number> {
  if (!deployment) return 0;
  let n = 0;
  for (const t of deployment.tokens) {
    const r = await db.query('UPDATE assets SET mirror_of = $2 WHERE mint = $1 AND mirror_of IS DISTINCT FROM $2', [t.mint, t.mainnetMint]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/**
 * Upserts the on-chain allow-list from the Asset accounts themselves, so the catalog and the pusher work
 * even when RPC history no longer holds the AssetAdded events. Each account's current price is kept as an
 * `onchain` sample at its last update time.
 */
export async function syncProgramAssets(db: Queryable, gateway: ChainGateway, deployment: Deployment | null): Promise<number> {
  const assets = await gateway.listProgramAssets();
  for (const a of assets) {
    await db.query(
      `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, token_program, program_listed, program_enabled, program_flagged, extra_cost_bps)
       VALUES ($1, $2, $2, $3, $4, $5, $6, true, $7, $8, $9)
       ON CONFLICT (mint) DO UPDATE SET program_listed = true, program_enabled = EXCLUDED.program_enabled,
         program_flagged = EXCLUDED.program_flagged, extra_cost_bps = EXCLUDED.extra_cost_bps, updated_at = now()`,
      [a.mint, a.symbol, normalizeSource(a.source) ?? 'xStocks', normalizeAssetType(a.assetType) ?? 'public_stock', a.decimals, a.tokenProgram, a.enabled, a.flagged, a.extraCostBps],
    );
    if (a.lastPriceTs > 0 && a.priceE6 > 0n) {
      await db.query(
        `INSERT INTO asset_prices (mint, kind, ts, price_e6) VALUES ($1, 'onchain', to_timestamp($2), $3) ON CONFLICT (mint, kind, ts) DO NOTHING`,
        [a.mint, a.lastPriceTs, a.priceE6.toString()],
      );
    }
  }
  await syncDeploymentMirrors(db, deployment);
  return assets.length;
}

export async function pushPrices(db: Queryable, gateway: ChainGateway, deployment: Deployment | null) {
  const listed = await syncProgramAssets(db, gateway, deployment);
  const rows = await db.query<{ mint: string; target: string }>(
    `SELECT a.mint, CASE WHEN a.mirror_of IS NOT NULL THEN COALESCE(m.ui_price_e6, m.price_e6) ELSE a.price_e6 END AS target
     FROM assets a LEFT JOIN assets m ON m.mint = a.mirror_of
     WHERE a.program_listed AND a.program_enabled IS NOT FALSE AND NOT a.fixture
       AND (CASE WHEN a.mirror_of IS NOT NULL THEN COALESCE(m.ui_price_e6, m.price_e6) ELSE a.price_e6 END) IS NOT NULL`,
  );
  const updates = rows.rows.map((r) => ({ mint: r.mint, priceE6: big(r.target) }));
  const signatures = updates.length ? await gateway.pushPrices(updates) : [];
  return { listed, pushed: updates.length, transactions: signatures.length };
}
