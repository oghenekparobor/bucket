import type { Queryable } from '../db/pool.js';
import type { HealthRecord } from './fetch.js';
import { catalogEligibility, type EligibilityRules } from './eligibility.js';
import { issuerEventFor } from './issuerEvents.js';
import type { ExistingAsset, MergePlan } from './merge.js';
import type { SourceToken } from './types.js';

const e6 = (usd: number | null) => (usd === null || !Number.isFinite(usd) ? null : BigInt(Math.round(usd * 1e6)).toString());

export async function recordHealth(db: Queryable, h: HealthRecord): Promise<void> {
  await db.query(
    `INSERT INTO source_health (source, ok, status_code, latency_ms, item_count, error) VALUES ($1, $2, $3, $4, $5, $6)`,
    [h.source, h.ok, h.statusCode, h.latencyMs, h.itemCount, h.error?.slice(0, 500) ?? null],
  );
}

/** Assets that came from an issuer feed (devnet mocks and fixture-only rows have no source payload). */
export async function loadExistingAssets(db: Queryable): Promise<ExistingAsset[]> {
  const r = await db.query(`SELECT mint, ticker, source, flagged, flag_reason, fixture FROM assets WHERE source_payload IS NOT NULL`);
  return r.rows.map((row) => ({ mint: row.mint, ticker: row.ticker, source: row.source, flagged: row.flagged, flagReason: row.flag_reason, fixture: row.fixture }));
}

/** Writes issuer/catalog columns only; price-service and program columns are untouched. */
export async function upsertSourceTokens(db: Queryable, tokens: SourceToken[], now: Date): Promise<void> {
  for (const t of tokens) {
    await db.query(
      `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, token_program, logo, sector, mark_price_e6,
         liquidity_usd, holders, last_seen_at, source_payload, fixture)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false)
       ON CONFLICT (mint) DO UPDATE SET ticker = EXCLUDED.ticker, name = EXCLUDED.name, source = EXCLUDED.source,
         asset_type = EXCLUDED.asset_type, decimals = EXCLUDED.decimals,
         token_program = COALESCE(EXCLUDED.token_program, assets.token_program), logo = COALESCE(EXCLUDED.logo, assets.logo),
         sector = COALESCE(EXCLUDED.sector, assets.sector), mark_price_e6 = COALESCE(EXCLUDED.mark_price_e6, assets.mark_price_e6),
         liquidity_usd = COALESCE(EXCLUDED.liquidity_usd, assets.liquidity_usd), holders = COALESCE(EXCLUDED.holders, assets.holders),
         last_seen_at = EXCLUDED.last_seen_at, missing_since = NULL, source_payload = EXCLUDED.source_payload,
         fixture = false, updated_at = now()`,
      [
        t.mint,
        t.ticker,
        t.name,
        t.source,
        t.assetType,
        t.decimals,
        t.tokenProgram,
        t.logo,
        t.sector,
        e6(t.markPrice),
        t.liquidityUsd,
        t.holders,
        now,
        JSON.stringify(t.payload ?? null),
      ],
    );
    if (t.markPrice !== null) {
      await db.query(
        `INSERT INTO asset_prices (mint, kind, ts, price_e6, ui_price_e6) VALUES ($1, 'mark', $2, $3, $3)
         ON CONFLICT (mint, kind, ts) DO NOTHING`,
        [t.mint, now, e6(t.markPrice)],
      );
    }
  }
}

export async function applyFlagChanges(db: Queryable, plan: MergePlan, now: Date): Promise<void> {
  for (const f of plan.flag) {
    await db.query(
      `UPDATE assets SET flagged = true, flag_reason = $2, missing_since = COALESCE(missing_since, $3), updated_at = now() WHERE mint = $1`,
      [f.mint, f.reason, now],
    );
    await db.query(`INSERT INTO catalog_audit (mint, action, reason, at) VALUES ($1, 'flagged', $2, $3)`, [f.mint, f.reason, now]);
  }
  for (const mint of plan.unflag) {
    await db.query(`UPDATE assets SET flagged = false, flag_reason = NULL, missing_since = NULL, updated_at = now() WHERE mint = $1`, [mint]);
    await db.query(`INSERT INTO catalog_audit (mint, action, reason, at) VALUES ($1, 'unflagged', 'reappeared_in_source', $2)`, [mint, now]);
  }
}

/**
 * Recomputes `eligible`, the first reason a token is not, and any issuer deadline, for every asset.
 * Devnet mocks inherit eligibility and issuer events from the mainnet token they mirror; a mock with no
 * mirror is eligible while enabled on-chain and priced.
 */
export async function recomputeEligibility(db: Queryable, rules: EligibilityRules): Promise<{ eligible: number; total: number }> {
  const r = await db.query(
    `SELECT a.mint, a.flagged, a.price_e6, a.liquidity_usd, a.min_trade_usd, a.mirror_of, a.program_listed, a.program_enabled,
       a.program_flagged, m.flagged AS m_flagged, m.price_e6 AS m_price, m.liquidity_usd AS m_liq, m.min_trade_usd AS m_min,
       EXISTS (SELECT 1 FROM asset_prices p WHERE p.mint = a.mint AND p.kind = 'program') AS has_program_price
     FROM assets a LEFT JOIN assets m ON m.mint = a.mirror_of`,
  );
  const num = (v: unknown) => (v === null ? null : Number(v));
  let eligible = 0;
  for (const row of r.rows) {
    const reasons: string[] = [];
    const event = issuerEventFor(row.mint, row.mirror_of);
    if (event) reasons.push(event.reason);
    if (row.program_listed && (row.program_enabled === false || row.program_flagged === true)) reasons.push('disabled_on_chain');
    if (row.mirror_of) {
      reasons.push(...catalogEligibility({ flagged: row.m_flagged, hasPrice: row.m_price !== null, liquidityUsd: num(row.m_liq), minTradeUsd: num(row.m_min) }, rules).reasons);
    } else if (row.program_listed && row.liquidity_usd === null) {
      // A mint known only on-chain (no issuer feed): usable while enabled and priced.
      if (row.price_e6 === null && !row.has_program_price) reasons.push('no_price');
    } else {
      reasons.push(...catalogEligibility({ flagged: row.flagged, hasPrice: row.price_e6 !== null, liquidityUsd: num(row.liquidity_usd), minTradeUsd: num(row.min_trade_usd) }, rules).reasons);
    }
    const ok = reasons.length === 0;
    if (ok) eligible++;
    await db.query(
      `UPDATE assets SET eligible = $2, eligibility_reason = $3, deadline = $4 WHERE mint = $1
         AND (eligible, eligibility_reason, deadline) IS DISTINCT FROM ($2, $3, $4::timestamptz)`,
      [row.mint, ok, reasons[0] ?? null, event?.deadline ?? null],
    );
  }
  return { eligible, total: r.rows.length };
}
