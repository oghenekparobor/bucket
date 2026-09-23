/**
 * Edit notifications (checklist 2.1): one in-app row per current holder, plus queued email / Telegram
 * deliveries for holders who added a channel. Rows are keyed by (event, wallet, kind), so replaying
 * events never duplicates or re-sends them.
 */
import type { Queryable } from '../db/pool.js';
import { changeSummary, type WeightEntry } from '../buckets/versions.js';
import { cleanText } from '../util/sanitize.js';

export interface EditNotice {
  eventId: number;
  bucket: string;
  kind: 'edit_proposed' | 'edit_activated';
  version: number;
  holdings: WeightEntry[];
  note: string | null;
  effectiveAt: Date;
  at: Date;
  platformWallet: string;
  /** Queue email/Telegram deliveries (false when replaying old history). */
  deliver: boolean;
}

function fmtUtc(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export async function notifyHolders(c: Queryable, n: EditNotice): Promise<number> {
  const b = await c.query<{ name: string }>('SELECT name FROM buckets WHERE address = $1', [n.bucket]);
  const name = cleanText(b.rows[0]?.name ?? 'A bucket you hold', 60);
  const prev = await c.query<{ holdings: WeightEntry[] }>(
    `SELECT holdings FROM bucket_versions WHERE bucket = $1 AND version < $2 AND activated_at IS NOT NULL
     ORDER BY version DESC LIMIT 1`,
    [n.bucket, n.version],
  );
  const mints = [...new Set([...n.holdings, ...(prev.rows[0]?.holdings ?? [])].map((h) => h.mint))];
  const tickers = new Map(
    (await c.query<{ mint: string; ticker: string }>('SELECT mint, ticker FROM assets WHERE mint = ANY($1)', [mints])).rows.map((r) => [r.mint, r.ticker]),
  );
  const change = changeSummary(prev.rows[0]?.holdings ?? null, n.holdings, (m) => tickers.get(m) ?? `${m.slice(0, 4)}…`);
  const note = n.note ? ` Note from the creator: "${cleanText(n.note, 140)}".` : '';
  const [title, body] =
    n.kind === 'edit_proposed'
      ? [`${name}: edit proposed`, `Version ${n.version} takes effect ${fmtUtc(n.effectiveAt)}. ${change}.${note} You can redeem or sell before then.`]
      : [`${name}: edit took effect`, `Version ${n.version} is live. ${change}. The vault rebalances to the new weights for all holders at once.`];

  const inserted = await c.query<{ id: string }>(
    `INSERT INTO notifications (wallet, kind, bucket, event_id, title, body, payload, created_at)
     SELECT p.wallet, $2, $1, $3, $4, $5, $6, $7 FROM positions p
     WHERE p.bucket = $1 AND p.tokens > 0 AND p.wallet <> $8
     ON CONFLICT (event_id, wallet, kind) DO NOTHING
     RETURNING id`,
    [n.bucket, n.kind, n.eventId, title, body, JSON.stringify({ version: n.version, effectiveAt: n.effectiveAt.toISOString() }), n.at, n.platformWallet],
  );
  const ids = inserted.rows.map((r) => r.id);
  if (n.deliver && ids.length) {
    await c.query(
      `INSERT INTO notification_deliveries (notification_id, channel)
       SELECT n.id, ch.channel FROM notifications n JOIN users u ON u.wallet = n.wallet
       CROSS JOIN LATERAL (VALUES ('email', u.email), ('telegram', u.telegram_chat_id)) AS ch(channel, target)
       WHERE n.id = ANY($1::bigint[]) AND ch.target IS NOT NULL
       ON CONFLICT (notification_id, channel) DO NOTHING`,
      [ids],
    );
  }
  return ids.length;
}
