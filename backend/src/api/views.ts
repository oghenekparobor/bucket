/**
 * Builders for the JSON shapes in docs/architecture.md §3. Conventions: USD totals as decimal strings with
 * 2 dp, per-token prices with 6 dp, percents as numbers rounded to 2 dp, token amounts as raw base-unit
 * integer strings (bucket tokens have 6 decimals), timestamps ISO 8601.
 */
import { changeSummary, diffHoldings, type WeightEntry } from '../buckets/versions.js';
import { maxWeightPct } from '../catalog/eligibility.js';
import type { Source, AssetType } from '../catalog/types.js';
import { config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { INITIAL_UNIT_PRICE_E6 } from '../perf/math.js';
import { big, formatE6, roundPct, valueE6 } from '../util/money.js';
import { DAY_MS, iso, type Period } from '../util/time.js';

export const usd = (e6: bigint) => formatE6(e6, 2);
export const price = (e6: bigint) => formatE6(e6, 6);
const pctOrNull = (v: unknown) => (v === null || v === undefined ? null : roundPct(Number(v)));

export interface CreatorRef {
  wallet: string;
  displayName: string | null;
  xHandle: string | null;
  xVerified: boolean;
}

export interface BucketSummary {
  address: string;
  slug: string;
  name: string;
  creator: CreatorRef;
  status: 'open' | 'closed';
  unitPrice: string;
  returns: Record<Period, number | null>;
  maxDrawdown: number;
  totalBacked: string;
  holders: number;
  ageDays: number;
  topHoldings: { ticker: string; weightPct: number }[];
  eligible: boolean;
}

export interface CatalogToken {
  mint: string;
  ticker: string;
  name: string;
  source: Source;
  assetType: AssetType;
  price: string;
  markPrice: string | null;
  liquidityUsd: string | null;
  decimals: number;
  logo: string | null;
  eligible: boolean;
  flagged: boolean;
  maxWeightPct: number;
  /** Additive to the §3 contract: why the token is not eligible, and an issuer deadline if any. */
  eligibilityReason: string | null;
  deadline: string | null;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Catalog rows: the on-chain allow-list when one exists (devnet mocks mirror their mainnet token's
 * metadata and prices), otherwise every token from the issuer feeds.
 */
export async function loadCatalog(db: Queryable, filter: { q?: string; source?: string } = {}): Promise<CatalogToken[]> {
  const r = await db.query(
    `WITH listed AS (SELECT EXISTS (SELECT 1 FROM assets WHERE program_listed) AS any)
     SELECT a.mint, COALESCE(m.ticker, a.ticker) AS ticker, COALESCE(m.name, a.name) AS name, a.source, a.asset_type, a.decimals,
       COALESCE(m.logo, a.logo) AS logo, a.eligible, a.flagged OR COALESCE(a.program_flagged, false) AS flagged,
       a.eligibility_reason, a.deadline,
       COALESCE(a.ui_price_e6, m.ui_price_e6,
         (SELECT p.price_e6 FROM asset_prices p WHERE p.mint = a.mint AND p.kind IN ('onchain', 'program') ORDER BY p.ts DESC LIMIT 1)) AS ui_price_e6,
       COALESCE(a.mark_price_e6, m.mark_price_e6) AS mark_price_e6, COALESCE(a.liquidity_usd, m.liquidity_usd) AS liquidity_usd
     FROM assets a LEFT JOIN assets m ON m.mint = a.mirror_of, listed
     WHERE (a.program_listed OR (NOT listed.any AND a.mirror_of IS NULL))
       AND ($1::text IS NULL OR a.ticker ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%' OR m.name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR a.source = $2)
     ORDER BY a.eligible DESC, COALESCE(a.liquidity_usd, m.liquidity_usd) DESC NULLS LAST, a.ticker`,
    [filter.q?.trim() || null, filter.source ?? null],
  );
  return r.rows
    .filter((row) => row.ui_price_e6 !== null)
    .map((row) => ({
      mint: row.mint,
      ticker: row.ticker,
      name: row.name,
      source: row.source,
      assetType: row.asset_type,
      price: price(big(row.ui_price_e6)),
      markPrice: row.mark_price_e6 === null ? null : price(big(row.mark_price_e6)),
      liquidityUsd: row.liquidity_usd === null ? null : Number(row.liquidity_usd).toFixed(2),
      decimals: row.decimals,
      logo: row.logo,
      eligible: row.eligible,
      flagged: row.flagged,
      maxWeightPct: maxWeightPct(row.asset_type),
      eligibilityReason: row.eligibility_reason,
      deadline: iso(row.deadline),
    }));
}

// ─── Buckets ──────────────────────────────────────────────────────────────────────────────────────────

export function creatorRef(wallet: string, row?: { display_name?: string | null; x_handle?: string | null; x_verified?: boolean | null }): CreatorRef {
  return {
    wallet,
    displayName: row?.display_name ?? null,
    xHandle: row?.x_handle ? `@${String(row.x_handle).replace(/^@/, '')}` : null,
    xVerified: row?.x_verified ?? false,
  };
}

/** Resolves a slug or bucket address to the bucket address. */
export async function resolveBucket(db: Queryable, slugOrAddress: string): Promise<string | null> {
  const r = await db.query<{ address: string }>(
    `SELECT b.address FROM buckets b LEFT JOIN bucket_slugs s ON s.bucket = b.address WHERE b.address = $1 OR s.slug = $1 LIMIT 1`,
    [slugOrAddress],
  );
  return r.rows[0]?.address ?? null;
}

/** Summaries for the given buckets (or a creator's buckets), keyed by address. */
export async function loadSummaries(db: Queryable, where: { addresses?: string[]; creator?: string }, nowMs = Date.now()): Promise<Map<string, BucketSummary>> {
  const r = await db.query(
    `SELECT b.address, s.slug, b.name, b.creator, b.status, b.created_at, m.unit_price_e6, m.returns, m.max_drawdown,
       m.vault_value_e6, m.holders, m.eligible, u.display_name, u.x_handle, u.x_verified,
       COALESCE((SELECT json_agg(json_build_object('ticker', COALESCE(a.ticker, h.mint), 'weight_bps', h.weight_bps) ORDER BY h.weight_bps DESC, h.position)
                 FROM holdings h LEFT JOIN assets a ON a.mint = h.mint WHERE h.bucket = b.address), '[]') AS holdings
     FROM buckets b
     LEFT JOIN bucket_slugs s ON s.bucket = b.address
     LEFT JOIN bucket_metrics m ON m.bucket = b.address
     LEFT JOIN users u ON u.wallet = b.creator
     WHERE ($1::text[] IS NULL OR b.address = ANY($1)) AND ($2::text IS NULL OR b.creator = $2)
     ORDER BY b.created_at`,
    [where.addresses ?? null, where.creator ?? null],
  );
  const out = new Map<string, BucketSummary>();
  for (const row of r.rows) {
    const returns = row.returns ?? {};
    out.set(row.address, {
      address: row.address,
      slug: row.slug ?? row.address,
      name: row.name,
      creator: creatorRef(row.creator, row),
      status: row.status,
      unitPrice: price(row.unit_price_e6 === null ? INITIAL_UNIT_PRICE_E6 : big(row.unit_price_e6)),
      returns: { '7d': pctOrNull(returns['7d']), '30d': pctOrNull(returns['30d']), '90d': pctOrNull(returns['90d']), all: pctOrNull(returns.all) },
      maxDrawdown: roundPct(Number(row.max_drawdown ?? 0)),
      totalBacked: usd(big(row.vault_value_e6)),
      holders: Number(row.holders ?? 0),
      ageDays: Math.floor((nowMs - (row.created_at as Date).getTime()) / DAY_MS),
      topHoldings: (row.holdings as { ticker: string; weight_bps: number }[]).slice(0, 3).map((h) => ({ ticker: h.ticker, weightPct: h.weight_bps / 100 })),
      eligible: row.eligible ?? false,
    });
  }
  return out;
}

export async function loadSummary(db: Queryable, address: string): Promise<BucketSummary | null> {
  return (await loadSummaries(db, { addresses: [address] })).get(address) ?? null;
}

export function shareUrl(slug: string): string {
  return `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/b/${slug}`;
}

export async function loadDetail(db: Queryable, address: string) {
  const summary = await loadSummary(db, address);
  if (!summary) return null;
  const [bucket, holdings, versions, pool, contrib] = await Promise.all([
    db.query(
      `SELECT b.thesis, b.created_at, b.version, b.token_mint, b.supply, b.hwm_e6, b.last_settled_at, b.event_count, b.creator_funded, m.unit_price_e6
       FROM buckets b LEFT JOIN bucket_metrics m ON m.bucket = b.address WHERE b.address = $1`,
      [address],
    ),
    db.query(
      `SELECT h.mint, h.weight_bps, a.ticker, COALESCE(mm.name, a.name) AS name, a.source, a.asset_type, a.decimals,
         COALESCE(a.ui_price_e6, mm.ui_price_e6) AS ui_price_e6, COALESCE(a.mark_price_e6, mm.mark_price_e6) AS mark_price_e6,
         COALESCE(v.balance, 0) - COALESCE(v.reserved, 0) AS available,
         (SELECT p.price_e6 FROM asset_prices p WHERE p.mint = h.mint AND p.kind IN ('onchain', 'program') ORDER BY p.ts DESC LIMIT 1) AS value_price_e6
       FROM holdings h LEFT JOIN assets a ON a.mint = h.mint LEFT JOIN assets mm ON mm.mint = a.mirror_of
       LEFT JOIN vault_balances v ON v.bucket = h.bucket AND v.mint = h.mint
       WHERE h.bucket = $1 ORDER BY h.weight_bps DESC, h.position`,
      [address],
    ),
    db.query(
      `SELECT v.version, v.holdings, v.note, v.effective_at, v.activated_at FROM bucket_versions v WHERE v.bucket = $1 ORDER BY v.version`,
      [address],
    ),
    db.query(`SELECT price_e6, ts FROM pool_prices WHERE bucket = $1 ORDER BY ts DESC LIMIT 1`, [address]),
    db.query(`SELECT contributions FROM bucket_metrics WHERE bucket = $1`, [address]),
  ]);
  const b = bucket.rows[0]!;
  const contributions: Record<string, number> = contrib.rows[0]?.contributions?.['30d'] ?? {};
  const allMints = [...new Set(versions.rows.flatMap((v) => (v.holdings as WeightEntry[]).map((h) => h.mint)))];
  const tickerRows = await db.query<{ mint: string; ticker: string }>('SELECT mint, ticker FROM assets WHERE mint = ANY($1)', [allMints]);
  const tickers = new Map(tickerRows.rows.map((r) => [r.mint, r.ticker]));
  const ticker = (mint: string) => tickers.get(mint) ?? `${mint.slice(0, 4)}…`;

  const holdingViews = holdings.rows.map((h) => {
    const ui = h.ui_price_e6 === null ? null : big(h.ui_price_e6);
    const mark = h.mark_price_e6 === null ? null : big(h.mark_price_e6);
    const valuePrice = h.value_price_e6 === null ? 0n : big(h.value_price_e6);
    return {
      mint: h.mint,
      ticker: h.ticker ?? ticker(h.mint),
      name: h.name ?? h.mint,
      source: h.source,
      assetType: h.asset_type,
      weightPct: h.weight_bps / 100,
      price: price(ui ?? valuePrice),
      markPrice: mark === null ? null : price(mark),
      markGapPct: mark && ui && mark > 0n ? roundPct((Number(ui) / Number(mark) - 1) * 100, 1) : null,
      contributionPct: contributions[h.mint] === undefined ? null : roundPct(contributions[h.mint]!),
      balance: big(h.available).toString(),
      valueUsd: usd(valueE6(big(h.available), valuePrice, h.decimals ?? 0)),
    };
  });

  const activated = versions.rows.filter((v) => v.activated_at !== null);
  const versionViews = activated
    .map((v, i) => ({
      version: v.version as number,
      activatedAt: iso(v.activated_at)!,
      holdings: (v.holdings as WeightEntry[]).map((h) => ({ ticker: ticker(h.mint), weightPct: h.weight_bps / 100 })),
      note: v.note as string | null,
      changeSummary: changeSummary(i === 0 ? null : (activated[i - 1]!.holdings as WeightEntry[]), v.holdings as WeightEntry[], ticker),
    }))
    .reverse();

  const pendingRow = versions.rows.filter((v) => v.activated_at === null && v.version > b.version).at(-1);
  const current = (activated.at(-1)?.holdings ?? []) as WeightEntry[];
  const pendingEdit = pendingRow
    ? {
        version: pendingRow.version as number,
        effectiveAt: iso(pendingRow.effective_at)!,
        note: pendingRow.note as string | null,
        diff: diffHoldings(current, pendingRow.holdings as WeightEntry[]).map((d) => ({ ticker: ticker(d.mint), fromPct: d.fromPct, toPct: d.toPct })),
      }
    : null;

  const unit = b.unit_price_e6 === null ? INITIAL_UNIT_PRICE_E6 : big(b.unit_price_e6);
  const poolRow = pool.rows[0];
  const poolPrice = poolRow ? big(poolRow.price_e6) : null;
  return {
    ...summary,
    thesis: b.thesis as string,
    // Other backers can mint only after one creator mint order has filled completely.
    fundingState: (summary.status === 'closed' ? 'closed' : b.creator_funded ? 'open' : 'awaiting_creator') as 'awaiting_creator' | 'open' | 'closed',
    createdAt: iso(b.created_at)!,
    version: b.version as number,
    tokenMint: b.token_mint as string,
    vault: address,
    supply: big(b.supply).toString(),
    hwm: price(big(b.hwm_e6)),
    poolPrice: poolPrice === null ? null : price(poolPrice),
    premiumPct: poolPrice === null ? null : roundPct((Number(poolPrice) / Number(unit) - 1) * 100),
    holdings: holdingViews,
    preIpoSharePct: holdings.rows.filter((h) => h.asset_type === 'pre_ipo').reduce((a, h) => a + h.weight_bps, 0) / 100,
    versions: versionViews,
    pendingEdit,
    lastSettledAt: iso(b.last_settled_at),
    eventCount: b.event_count as number,
    shareUrl: shareUrl(summary.slug),
  };
}
