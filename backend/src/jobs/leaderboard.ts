/**
 * Leaderboard job (hourly): one snapshot per period (7d, 30d, 90d, all), ranked by unit price return.
 * Phase 1 ranks every bucket; LEADERBOARD_ENFORCE_ELIGIBILITY=true ranks only eligible ones. Eligibility
 * for the default period (30d) is also written to bucket_metrics for bucket summaries.
 */
import { type Config, config } from '../config.js';
import { type Db, withTx } from '../db/pool.js';
import { checkEligibility, minCreatorStakeUsd, stakeLookbackDays } from '../perf/eligibility.js';
import { sample, type UnitPoint } from '../perf/metrics.js';
import { big } from '../util/money.js';
import { DAY_MS, PERIODS, type Period, periodDays } from '../util/time.js';

export const DEFAULT_PERIOD: Period = '30d';
const SPARK_POINTS = 30;

interface Candidate {
  bucket: string;
  totalBacked: bigint;
  byPeriod: Record<Period, { ret: number | null; eligible: boolean; reasons: string[]; spark: number[] }>;
}

export async function runLeaderboard(db: Db, now = new Date(), cfg: Config = config) {
  const nowMs = now.getTime();
  const buckets = await db.query(
    `SELECT b.address, b.creator, b.created_at, b.status, m.returns, m.vault_value_e6,
       COALESCE((SELECT array_agg(COALESCE(a.ticker, h.mint)) FROM holdings h LEFT JOIN assets a ON a.mint = h.mint
                 WHERE h.bucket = b.address AND NOT COALESCE(a.eligible, false)), '{}') AS illiquid
     FROM buckets b JOIN bucket_metrics m ON m.bucket = b.address`,
  );

  const candidates: Candidate[] = [];
  for (const b of buckets.rows) {
    const [hourly, creatorLog] = await Promise.all([
      db.query('SELECT hour, unit_price_e6 FROM unit_price_hourly WHERE bucket = $1 ORDER BY hour', [b.address]),
      db.query('SELECT ts, tokens FROM position_log WHERE wallet = $1 AND bucket = $2 ORDER BY ts, event_id', [b.creator, b.address]),
    ]);
    const units: UnitPoint[] = hourly.rows.map((r) => ({ t: (r.hour as Date).getTime(), u: Number(r.unit_price_e6) / 1e6 }));
    const tokens = creatorLog.rows.map((r) => ({ t: (r.ts as Date).getTime(), tokens: big(r.tokens) }));
    const createdMs = (b.created_at as Date).getTime();
    const ageDays = (nowMs - createdMs) / DAY_MS;

    const byPeriod = {} as Candidate['byPeriod'];
    for (const period of PERIODS) {
      const lookback = stakeLookbackDays(period, ageDays);
      const result = checkEligibility({
        period,
        nowMs,
        createdAtMs: createdMs,
        status: b.status,
        creatorMinStakeUsd: minCreatorStakeUsd(units, tokens, nowMs - lookback * DAY_MS),
        illiquidHoldings: b.illiquid,
      });
      byPeriod[period] = {
        ret: b.returns[period] ?? null,
        eligible: result.eligible,
        reasons: result.reasons,
        spark: sample(units, periodDays(period), SPARK_POINTS).map((p) => Math.round(p.u * 100) / 100),
      };
    }
    candidates.push({ bucket: b.address, totalBacked: big(b.vault_value_e6), byPeriod });
  }

  const enforce = cfg.LEADERBOARD_ENFORCE_ELIGIBILITY;
  await withTx(db, async (c) => {
    for (const period of PERIODS) {
      const ranked = candidates
        .filter((x) => !enforce || x.byPeriod[period].eligible)
        .sort((a, b) => {
          const ra = a.byPeriod[period].ret;
          const rb = b.byPeriod[period].ret;
          if (ra === null || rb === null) return ra === rb ? Number(b.totalBacked - a.totalBacked) : ra === null ? 1 : -1;
          return rb - ra || Number(b.totalBacked - a.totalBacked);
        });
      const snap = await c.query<{ id: string }>(
        'INSERT INTO leaderboard_snapshots (period, computed_at, enforce_eligibility) VALUES ($1, $2, $3) RETURNING id',
        [period, now, enforce],
      );
      for (const [i, x] of ranked.entries()) {
        const row = x.byPeriod[period];
        await c.query(
          `INSERT INTO leaderboard_rows (snapshot_id, rank, bucket, ret, eligible, reasons, spark) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [snap.rows[0]!.id, i + 1, x.bucket, row.ret, row.eligible, row.reasons, JSON.stringify(row.spark)],
        );
      }
      await c.query(
        `DELETE FROM leaderboard_snapshots WHERE period = $1 AND computed_at < $2::timestamptz - interval '7 days'`,
        [period, now],
      );
    }
    for (const x of candidates) {
      const d = x.byPeriod[DEFAULT_PERIOD];
      await c.query('UPDATE bucket_metrics SET eligible = $2, ineligible_reasons = $3 WHERE bucket = $1', [x.bucket, d.eligible, d.reasons]);
    }
  });
  return { buckets: candidates.length, eligible: candidates.filter((x) => x.byPeriod[DEFAULT_PERIOD].eligible).length, enforce };
}
