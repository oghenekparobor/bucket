/**
 * Operational alerts: structured log line, a row in `alerts`, and an optional webhook POST
 * (ALERT_WEBHOOK_URL; Slack-compatible `text` field). Repeats of the same code+key within the quiet
 * window are logged at debug only.
 */
import type { Queryable } from './db/pool.js';
import type { Logger } from './logger.js';

export type AlertLevel = 'info' | 'warn' | 'error';

export interface AlertSink {
  raise(level: AlertLevel, code: string, key: string, message: string, context?: Record<string, unknown>): Promise<void>;
}

export class Alerter implements AlertSink {
  constructor(
    private readonly db: Queryable,
    private readonly log: Logger,
    private readonly webhookUrl?: string,
    private readonly quietMs = 30 * 60_000,
  ) {}

  async raise(level: AlertLevel, code: string, key: string, message: string, context: Record<string, unknown> = {}): Promise<void> {
    const recent = await this.db.query(
      `SELECT 1 FROM alerts WHERE code = $1 AND key = $2 AND created_at > now() - ($3 || ' milliseconds')::interval LIMIT 1`,
      [code, key, String(this.quietMs)],
    );
    if (recent.rowCount) {
      this.log.debug({ alert: code, key }, 'alert suppressed (repeat)');
      return;
    }
    this.log[level]({ alert: code, key, ...context }, message);
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO alerts (level, code, key, message, context) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [level, code, key, message, JSON.stringify(context)],
    );
    if (!this.webhookUrl) return;
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `[bucket ${level}] ${code}: ${message}`, level, code, key, context }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) await this.db.query('UPDATE alerts SET delivered = true WHERE id = $1', [row.rows[0]!.id]);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'alert webhook failed');
    }
  }
}
