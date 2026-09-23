/**
 * Performance job (hourly resolution, run every few minutes): extends each bucket's hourly unit price
 * series from its event logs and price history, then recomputes returns, max drawdown, contribution per
 * holding, total backed and holders into `bucket_metrics`.
 */
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { contributions, type ContributionRow, maxDrawdown, periodReturn, type UnitPoint } from '../perf/metrics.js';
import { type BucketHistory, computeSeries, hourlyTimes, type SeriesPoint } from '../perf/series.js';
import { big } from '../util/money.js';
import { DAY_MS, HOUR_MS, PERIODS, periodDays } from '../util/time.js';

interface BucketRow {
  address: string;
  created_at: Date;
}

const ms = (d: Date) => d.getTime();

/** Loads everything the series computation needs for one bucket, with prices from `fromMs` onward. */
export async function loadHistory(db: Db, bucket: string, fromMs: number): Promise<BucketHistory> {
  const [balances, supplies, hwms] = await Promise.all([
    db.query(`SELECT mint, ts, balance, reserved FROM vault_balance_log WHERE bucket = $1 ORDER BY ts, event_id`, [bucket]),
    db.query(`SELECT ts, supply FROM supply_log WHERE bucket = $1 ORDER BY ts, event_id`, [bucket]),
    db.query(`SELECT ts, hwm_after_e6 FROM commission_settlements WHERE bucket = $1 ORDER BY ts, event_id`, [bucket]),
  ]);
  const mints = [...new Set(balances.rows.map((r) => r.mint as string))];
  const [decimals, prices] = await Promise.all([
    db.query<{ mint: string; decimals: number }>('SELECT mint, decimals FROM assets WHERE mint = ANY($1)', [mints]),
    db.query<{ mint: string; ts: Date; price_e6: string }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (mint) mint, ts, price_e6 FROM asset_prices
         WHERE mint = ANY($1) AND kind IN ('onchain', 'program') AND ts < $2 ORDER BY mint, ts DESC
       ) before_window
       UNION ALL
       SELECT mint, ts, price_e6 FROM asset_prices WHERE mint = ANY($1) AND kind IN ('onchain', 'program') AND ts >= $2
       ORDER BY ts`,
      [mints, new Date(fromMs)],
    ),
  ]);
  const byMint: BucketHistory['prices'] = {};
  for (const p of prices.rows) (byMint[p.mint] ??= []).push({ ts: ms(p.ts), priceE6: big(p.price_e6) });
  return {
    decimals: Object.fromEntries(decimals.rows.map((r) => [r.mint, r.decimals])),
    balances: balances.rows.map((r) => ({ ts: ms(r.ts), mint: r.mint, balance: big(r.balance), reserved: big(r.reserved) })),
    supplies: supplies.rows.map((r) => ({ ts: ms(r.ts), supply: big(r.supply) })),
    hwms: hwms.rows.map((r) => ({ ts: ms(r.ts), hwmE6: big(r.hwm_after_e6) })),
    prices: byMint,
  };
}

const jsonMap = (m: Record<string, bigint>) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.toString()])));

async function upsertHourly(db: Db, bucket: string, points: SeriesPoint[]): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < points.length; i += BATCH) {
    const slice = points.slice(i, i + BATCH);
    await db.query(
      `INSERT INTO unit_price_hourly (bucket, hour, unit_price_e6, vault_value_e6, supply, hwm_e6, holding_values, prices)
       SELECT $1, * FROM unnest($2::timestamptz[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::jsonb[], $8::jsonb[])
       ON CONFLICT (bucket, hour) DO UPDATE SET unit_price_e6 = EXCLUDED.unit_price_e6, vault_value_e6 = EXCLUDED.vault_value_e6,
         supply = EXCLUDED.supply, hwm_e6 = EXCLUDED.hwm_e6, holding_values = EXCLUDED.holding_values, prices = EXCLUDED.prices`,
      [
        bucket,
        slice.map((p) => new Date(p.t)),
        slice.map((p) => p.unitPriceE6.toString()),
        slice.map((p) => p.vaultValueE6.toString()),
        slice.map((p) => p.supply.toString()),
        slice.map((p) => p.hwmE6.toString()),
        slice.map((p) => jsonMap(p.holdingValues)),
        slice.map((p) => jsonMap(p.prices)),
      ],
    );
  }
}

const toBigMap = (o: Record<string, string>) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, big(v)]));

export async function computeBucketMetrics(db: Db, b: BucketRow, now: Date, full: boolean): Promise<void> {
  const nowMs = now.getTime();
  const last = await db.query<{ hour: Date | null }>('SELECT max(hour) AS hour FROM unit_price_hourly WHERE bucket = $1', [b.address]);
  const lastHour = last.rows[0]?.hour ? ms(last.rows[0].hour) : null;
  const fromMs = full || lastHour === null ? ms(b.created_at) : Math.max(ms(b.created_at), lastHour - 2 * HOUR_MS);
  if (full) await db.query('DELETE FROM unit_price_hourly WHERE bucket = $1', [b.address]);

  const history = await loadHistory(db, b.address, fromMs);
  await upsertHourly(db, b.address, computeSeries(history, hourlyTimes(fromMs, nowMs)));
  const live = computeSeries(history, [nowMs])[0];

  const hourly = await db.query(
    'SELECT hour, unit_price_e6, supply, holding_values, prices FROM unit_price_hourly WHERE bucket = $1 ORDER BY hour',
    [b.address],
  );
  const rows: (ContributionRow & { t: number })[] = hourly.rows.map((r) => ({
    t: ms(r.hour),
    unitPriceE6: big(r.unit_price_e6),
    supply: big(r.supply),
    holdingValues: toBigMap(r.holding_values),
    prices: toBigMap(r.prices),
  }));
  if (live && (rows.length === 0 || rows.at(-1)!.t < live.t)) rows.push({ ...live, t: live.t });
  const points: UnitPoint[] = rows.map((r) => ({ t: r.t, u: Number(r.unitPriceE6) / 1e6 }));

  const createdMs = ms(b.created_at);
  const returns = Object.fromEntries(PERIODS.map((p) => [p, periodReturn(points, p, createdMs)]));
  const contrib = Object.fromEntries(
    PERIODS.map((p) => {
      const days = periodDays(p);
      const from = days === null ? -Infinity : nowMs - days * DAY_MS;
      const firstInWindow = rows.findIndex((r) => r.t >= from);
      if (firstInWindow === -1) return [p, {}];
      return [p, contributions(rows.slice(Math.max(0, firstInWindow - 1)))];
    }),
  );
  const holders = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM positions WHERE bucket = $1 AND tokens > 0 AND wallet <> $2`,
    [b.address, config.PLATFORM_FEE_WALLET],
  );
  await db.query(
    `INSERT INTO bucket_metrics (bucket, unit_price_e6, vault_value_e6, supply, returns, max_drawdown, contributions, holders, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (bucket) DO UPDATE SET unit_price_e6 = EXCLUDED.unit_price_e6, vault_value_e6 = EXCLUDED.vault_value_e6,
       supply = EXCLUDED.supply, returns = EXCLUDED.returns, max_drawdown = EXCLUDED.max_drawdown,
       contributions = EXCLUDED.contributions, holders = EXCLUDED.holders, computed_at = EXCLUDED.computed_at`,
    [
      b.address,
      live?.unitPriceE6.toString() ?? null,
      live?.vaultValueE6.toString() ?? '0',
      live?.supply.toString() ?? '0',
      JSON.stringify(returns),
      maxDrawdown(points),
      JSON.stringify(contrib),
      Number(holders.rows[0]?.n ?? 0),
      now,
    ],
  );
}

/** Recomputes metrics for specific buckets (after the indexer ingests their events). */
export async function refreshBuckets(db: Db, addresses: string[], now = new Date()): Promise<void> {
  const buckets = await db.query<BucketRow>('SELECT address, created_at FROM buckets WHERE address = ANY($1)', [addresses]);
  for (const b of buckets.rows) await computeBucketMetrics(db, b, now, false);
}

export async function runPerformance(db: Db, now = new Date(), opts: { full?: boolean } = {}) {
  const buckets = await db.query<BucketRow>('SELECT address, created_at FROM buckets ORDER BY created_at');
  for (const b of buckets.rows) await computeBucketMetrics(db, b, now, opts.full ?? false);
  return { buckets: buckets.rows.length };
}
