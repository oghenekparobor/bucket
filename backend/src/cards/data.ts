/**
 * Loads and sanitizes everything a card shows. All user-controlled strings (bucket name, display name,
 * handle, tickers) pass through cleanText with hard length limits before reaching the renderer.
 */
import { loadSummary, resolveBucket, shareUrl } from '../api/views.js';
import type { Queryable } from '../db/pool.js';
import { holderView, type PositionState } from '../perf/costBasis.js';
import { INITIAL_UNIT_PRICE_E6 } from '../perf/math.js';
import { big, E6, formatE6 } from '../util/money.js';
import { cleanText } from '../util/sanitize.js';
import { DAY_MS, type Period, periodDays } from '../util/time.js';
import type { PnlCardData, PreviewCardData } from './layouts.js';
import { fmtPct } from './layouts.js';

const PERIOD_TAG: Record<Period, string> = { '7d': '7 DAYS', '30d': '30 DAYS', '90d': '90 DAYS', all: 'ALL TIME' };

function creatorLine(s: { creator: { wallet: string; displayName: string | null; xHandle: string | null } }): string {
  const name = cleanText(s.creator.displayName, 40) || `${s.creator.wallet.slice(0, 4)}…${s.creator.wallet.slice(-4)}`;
  const handle = cleanText(s.creator.xHandle, 32);
  return handle ? `${name} · ${handle}` : name;
}

/** "bucket.xyz/b/frontier-labs" (no scheme) for printing on cards. */
export function shortLink(slug: string): string {
  return shareUrl(slug).replace(/^https?:\/\//, '');
}

const dollars = (e6: bigint) => {
  const abs = e6 < 0n ? -e6 : e6;
  const [whole] = formatE6(abs, 0).split('.');
  return `${e6 < 0n ? '-' : '+'}$${Number(whole).toLocaleString('en-US')}`;
};

export async function previewCardData(db: Queryable, slug: string): Promise<PreviewCardData | null> {
  const address = await resolveBucket(db, slug);
  const s = address ? await loadSummary(db, address) : null;
  if (!s) return null;
  const top = await db.query(
    `SELECT COALESCE(a.ticker, h.mint) AS ticker, h.weight_bps, a.asset_type FROM holdings h LEFT JOIN assets a ON a.mint = h.mint
     WHERE h.bucket = $1 ORDER BY h.weight_bps DESC, h.position LIMIT 3`,
    [s.address],
  );
  return {
    name: cleanText(s.name, 48),
    creatorLine: creatorLine(s),
    xVerified: s.creator.xVerified,
    return30d: s.returns['30d'],
    maxDrawdown: s.maxDrawdown,
    top: top.rows.map((t) => ({ ticker: cleanText(t.ticker, 16), weightPct: t.weight_bps / 100, preIpo: t.asset_type === 'pre_ipo' })),
    shortLink: shortLink(s.slug),
  };
}

export interface PnlOptions {
  period: Period;
  wallet: string | null;
  showDollars: boolean;
}

/**
 * Bucket return for the period, or, when `wallet` holds the bucket, the holder's own return: against
 * what they paid when they entered inside the period (or period = all), otherwise the unit price change
 * over the period. Dollar amounts only when `showDollars`.
 */
export async function pnlCardData(db: Queryable, slug: string, o: PnlOptions): Promise<PnlCardData | null> {
  const address = await resolveBucket(db, slug);
  const s = address ? await loadSummary(db, address) : null;
  if (!s) return null;
  const base = {
    name: cleanText(s.name, 48),
    creatorLine: creatorLine(s),
    periodTag: PERIOD_TAG[o.period],
    shortLink: shortLink(s.slug),
    qrUrl: shareUrl(s.slug),
  };

  const pos = o.wallet
    ? (await db.query(`SELECT * FROM positions WHERE wallet = $1 AND bucket = $2 AND tokens > 0`, [o.wallet, s.address])).rows[0]
    : undefined;
  if (!pos) {
    return { ...base, label: `RETURN · ${PERIOD_TAG[o.period]}`, value: fmtPct(s.returns[o.period]), dollarsLine: null, footnote: 'Scan to check it against chain data' };
  }

  const metrics = await db.query(`SELECT unit_price_e6 FROM bucket_metrics WHERE bucket = $1`, [s.address]);
  const unit = metrics.rows[0]?.unit_price_e6 ? big(metrics.rows[0].unit_price_e6) : INITIAL_UNIT_PRICE_E6;
  const days = periodDays(o.period);
  const periodStart = days === null ? null : Date.now() - days * DAY_MS;
  let pct: number | null;
  let gainE6: bigint;
  let basisE6: bigint;
  if (periodStart === null || (pos.first_entry_at as Date).getTime() >= periodStart) {
    const p: PositionState = {
      tokens: big(pos.tokens),
      costE6: big(pos.cost_e6),
      realizedE6: 0n,
      paidTotalE6: 0n,
      receivedTotalE6: 0n,
      commissionPaidE6: 0n,
      commissionEarnedE6: 0n,
    };
    const v = holderView(p, unit);
    pct = v.gainPct;
    gainE6 = v.gainE6;
    basisE6 = v.paidE6;
  } else {
    const ref = await db.query(
      `SELECT unit_price_e6 FROM unit_price_hourly WHERE bucket = $1 AND hour <= $2 ORDER BY hour DESC LIMIT 1`,
      [s.address, new Date(periodStart)],
    );
    const start = ref.rows[0] ? big(ref.rows[0].unit_price_e6) : unit;
    pct = (Number(unit) / Number(start) - 1) * 100;
    gainE6 = (big(pos.tokens) * (unit - start)) / E6;
    basisE6 = (big(pos.tokens) * start) / E6;
  }
  return {
    ...base,
    label: `MY RETURN · ${PERIOD_TAG[o.period]}`,
    value: fmtPct(pct),
    dollarsLine: o.showDollars ? `${dollars(gainE6)} on $${Number(formatE6(basisE6, 0)).toLocaleString('en-US')}` : null,
    footnote: o.showDollars ? 'Dollar amounts shown by the holder' : 'Dollar amounts hidden',
  };
}
