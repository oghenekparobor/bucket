/**
 * Pool price monitor (checklist 2.2): records each bucket token's pool price when a pool exists,
 * computes the premium or discount to unit price, and alerts when the gap stays above the threshold
 * (default 1%) for over an hour. Pools do not exist yet, so the price source returns null until the
 * Meteora DAMM v2 integration lands; `pool_address` stays NULL and poolPrice is reported as null.
 */
import type { AlertSink } from '../alerts.js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { fetchPrices } from '../catalog/sources/jupiter.js';
import { big } from '../util/money.js';
import { HOUR_MS } from '../util/time.js';

export interface PoolPriceSource {
  /** Pool price of one bucket token in micro-dollars, or null when there is no pool / no quote. */
  price(bucket: { address: string; tokenMint: string; poolAddress: string | null }): Promise<bigint | null>;
}

/**
 * Mainnet: Jupiter price v3 on the bucket token mint prices it at the pool it trades in. Elsewhere
 * there is no market to read yet.
 */
export class JupiterPoolPriceSource implements PoolPriceSource {
  async price(b: { tokenMint: string; poolAddress: string | null }): Promise<bigint | null> {
    if (config.CLUSTER !== 'mainnet-beta' || !b.poolAddress) return null;
    const r = await fetchPrices([b.tokenMint]);
    const p = r.data?.[b.tokenMint];
    return p && p.usdPrice > 0 ? BigInt(Math.round(p.usdPrice * 1e6)) : null;
  }
}

export function premiumPct(poolE6: bigint, unitE6: bigint): number {
  return (Number(poolE6) / Number(unitE6) - 1) * 100;
}

/**
 * True when every sample in the last `windowMs` is more than `thresholdPct` away from unit price and
 * the samples actually cover the whole window.
 */
export function sustainedGap(samples: { t: number; gapPct: number }[], nowMs: number, thresholdPct: number, windowMs = HOUR_MS): boolean {
  const recent = samples.filter((s) => s.t >= nowMs - windowMs - 10 * 60_000).sort((a, b) => a.t - b.t);
  const inWindow = recent.filter((s) => s.t >= nowMs - windowMs);
  const covering = recent.find((s) => s.t <= nowMs - windowMs);
  if (!covering || inWindow.length === 0) return false;
  return [covering, ...inWindow].every((s) => Math.abs(s.gapPct) > thresholdPct);
}

export async function runPoolMonitor(db: Db, source: PoolPriceSource, alerts: AlertSink, now = new Date()) {
  const buckets = await db.query(
    `SELECT b.address, b.token_mint, b.pool_address, m.unit_price_e6 FROM buckets b JOIN bucket_metrics m ON m.bucket = b.address
     WHERE b.status = 'open' AND m.unit_price_e6 IS NOT NULL`,
  );
  let priced = 0;
  let alerted = 0;
  for (const b of buckets.rows) {
    const pool = await source.price({ address: b.address, tokenMint: b.token_mint, poolAddress: b.pool_address });
    if (pool === null) continue;
    priced++;
    await db.query(
      `INSERT INTO pool_prices (bucket, ts, price_e6, source) VALUES ($1, $2, $3, 'jupiter') ON CONFLICT (bucket, ts) DO NOTHING`,
      [b.address, now, pool.toString()],
    );
    const history = await db.query(
      `SELECT p.ts, p.price_e6,
         (SELECT u.unit_price_e6 FROM unit_price_hourly u WHERE u.bucket = p.bucket AND u.hour <= p.ts ORDER BY u.hour DESC LIMIT 1) AS unit
       FROM pool_prices p WHERE p.bucket = $1 AND p.ts > $2::timestamptz - interval '75 minutes'`,
      [b.address, now],
    );
    const samples = history.rows
      .filter((r) => r.unit !== null)
      .map((r) => ({ t: (r.ts as Date).getTime(), gapPct: premiumPct(big(r.price_e6), big(r.unit)) }));
    if (sustainedGap(samples, now.getTime(), config.POOL_GAP_ALERT_PCT)) {
      alerted++;
      const gap = premiumPct(pool, big(b.unit_price_e6));
      await alerts.raise('warn', 'pool_gap', b.address, `Pool price ${gap.toFixed(2)}% from unit price for over an hour`, {
        bucket: b.address,
        gapPct: gap,
      });
    }
  }
  return { buckets: buckets.rows.length, priced, alerted };
}
