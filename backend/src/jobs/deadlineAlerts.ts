/**
 * Daily: alert for every bucket that holds a token whose issuer conversion or redemption deadline is
 * less than 60 days away (or already passed), so the forced swap or edit can be scheduled in time.
 */
import type { AlertSink } from '../alerts.js';
import type { Queryable } from '../db/pool.js';

export const DEADLINE_WARNING_DAYS = 60;

export async function runDeadlineAlerts(db: Queryable, alerts: AlertSink, now = new Date()) {
  const rows = await db.query<{ address: string; name: string; ticker: string; deadline: Date; reason: string }>(
    `SELECT DISTINCT b.address, b.name, a.ticker, a.deadline, a.eligibility_reason AS reason
     FROM holdings h JOIN buckets b ON b.address = h.bucket JOIN assets a ON a.mint = h.mint
     WHERE a.deadline IS NOT NULL AND a.deadline < $1::timestamptz + make_interval(days => $2) AND NOT b.fixture
     ORDER BY a.deadline`,
    [now, DEADLINE_WARNING_DAYS],
  );
  for (const r of rows.rows) {
    const days = Math.floor((r.deadline.getTime() - now.getTime()) / 86_400_000);
    await alerts.raise(
      days <= 7 ? 'error' : 'warn',
      'holding_deadline',
      `${r.address}:${r.ticker}`,
      `${r.name} holds ${r.ticker}, which must be swapped or redeemed by ${r.deadline.toISOString()} (${days} days)`,
      { bucket: r.address, ticker: r.ticker, deadline: r.deadline.toISOString(), reason: r.reason },
    );
  }
  return { alerted: rows.rows.length };
}
