/** Sends queued notification deliveries (email / Telegram), retrying failures up to MAX_ATTEMPTS. */
import type { Db } from '../db/pool.js';
import type { EmailProvider, TelegramSender } from './channels.js';

const MAX_ATTEMPTS = 5;

export async function dispatchPending(
  db: Db,
  channels: { email: EmailProvider; telegram: TelegramSender | null },
  opts: { publicWebUrl: string; limit?: number },
) {
  const pending = await db.query(
    `SELECT d.id, d.channel, d.attempts, n.title, n.body, u.email, u.telegram_chat_id, s.slug
     FROM notification_deliveries d
     JOIN notifications n ON n.id = d.notification_id
     JOIN users u ON u.wallet = n.wallet
     LEFT JOIN bucket_slugs s ON s.bucket = n.bucket
     WHERE d.status = 'pending' ORDER BY d.id LIMIT $1`,
    [opts.limit ?? 100],
  );
  let sent = 0;
  let failed = 0;
  for (const d of pending.rows) {
    const link = d.slug ? `\n\n${opts.publicWebUrl}/b/${d.slug}` : '';
    try {
      if (d.channel === 'email' && d.email) {
        await channels.email.send({ to: d.email, subject: d.title, text: d.body + link });
      } else if (d.channel === 'telegram' && d.telegram_chat_id && channels.telegram) {
        await channels.telegram.send(d.telegram_chat_id, `${d.title}\n\n${d.body}${link}`);
      } else {
        await db.query(`UPDATE notification_deliveries SET status = 'skipped' WHERE id = $1`, [d.id]);
        continue;
      }
      await db.query(`UPDATE notification_deliveries SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [d.id]);
      sent++;
    } catch (err) {
      failed++;
      await db.query(
        `UPDATE notification_deliveries SET attempts = attempts + 1, last_error = $2,
           status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END WHERE id = $1`,
        [d.id, (err as Error).message.slice(0, 500), MAX_ATTEMPTS],
      );
    }
  }
  return { pending: pending.rows.length, sent, failed };
}
