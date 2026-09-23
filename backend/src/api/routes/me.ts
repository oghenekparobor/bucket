import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { holderView } from '../../perf/costBasis.js';
import { INITIAL_UNIT_PRICE_E6 } from '../../perf/math.js';
import { big, roundPct } from '../../util/money.js';
import type { AppContext } from '../app.js';
import { parse } from '../errors.js';
import { loadSummaries, price, usd } from '../views.js';

const BALANCE_TIMEOUT_MS = 4_000;

export function registerMeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, gateway } = ctx;

  app.get('/v1/me', async (req) => {
    const user = await ctx.requireUser(req);
    const row = await db.query(`SELECT telegram_chat_id FROM users WHERE wallet = $1`, [user.wallet]);
    let balances: { solLamports: bigint; usdcE6: bigint } | null = null;
    try {
      balances = await Promise.race([
        gateway.getWalletBalances(user.wallet),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), BALANCE_TIMEOUT_MS)),
      ]);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'balance lookup failed');
    }
    return {
      userId: user.userId,
      wallet: user.wallet,
      email: user.email,
      xHandle: user.xHandle ? `@${user.xHandle.replace(/^@/, '')}` : null,
      xVerified: user.xVerified,
      telegramChatId: row.rows[0]?.telegram_chat_id ?? null,
      usdcBalance: balances ? usd(balances.usdcE6) : null,
      solBalance: balances ? (Number(balances.solLamports) / 1e9).toFixed(9) : null,
    };
  });

  app.get('/v1/me/portfolio', async (req) => {
    const user = await ctx.requireUser(req);
    const rows = await db.query(
      `SELECT p.*, m.unit_price_e6 FROM positions p LEFT JOIN bucket_metrics m ON m.bucket = p.bucket
       WHERE p.wallet = $1 AND p.tokens > 0 ORDER BY p.first_entry_at`,
      [user.wallet],
    );
    const summaries = await loadSummaries(db, { addresses: rows.rows.map((r) => r.bucket) });
    let value = 0n;
    let paid = 0n;
    let commission = 0n;
    const positions = rows.rows
      .filter((r) => summaries.has(r.bucket))
      .map((r) => {
        const unit = r.unit_price_e6 === null ? INITIAL_UNIT_PRICE_E6 : big(r.unit_price_e6);
        const view = holderView(
          {
            tokens: big(r.tokens),
            costE6: big(r.cost_e6),
            realizedE6: big(r.realized_e6),
            paidTotalE6: big(r.paid_total_e6),
            receivedTotalE6: big(r.received_total_e6),
            commissionPaidE6: big(r.commission_paid_e6),
            commissionEarnedE6: big(r.commission_earned_e6),
          },
          unit,
        );
        value += view.valueE6;
        paid += view.paidE6;
        commission += big(r.commission_paid_e6);
        return {
          bucket: summaries.get(r.bucket)!,
          tokens: big(r.tokens).toString(),
          unitPrice: price(unit),
          value: usd(view.valueE6),
          paid: usd(view.paidE6),
          gainUsd: usd(view.gainE6),
          gainPct: view.gainPct === null ? null : roundPct(view.gainPct),
        };
      });
    return {
      positions,
      totals: {
        value: usd(value),
        paid: usd(paid),
        gainUsd: usd(value - paid),
        gainPct: paid > 0n ? roundPct((Number(value - paid) / Number(paid)) * 100) : null,
        commissionPaid: usd(commission),
      },
    };
  });

  /** Creator dashboard: own buckets, backers by day (30 days), commission, share-link funnel. */
  app.get('/v1/me/dashboard', async (req) => {
    const user = await ctx.requireUser(req);
    const summaries = [...(await loadSummaries(db, { creator: user.wallet })).values()];
    const addresses = summaries.map((s) => s.address);
    const slugs = summaries.map((s) => s.slug);
    const [byDay, commission, last, funnel] = await Promise.all([
      db.query(
        `SELECT d::date AS day,
           (SELECT count(*) FROM backer_attributions a WHERE a.bucket = ANY($1) AND a.created_at::date = d::date) AS new_backers,
           (SELECT COALESCE(sum(o.amount_e6), 0) FROM mint_orders o WHERE o.bucket = ANY($1) AND o.opened_at::date = d::date) AS deposits
         FROM generate_series(current_date - 29, current_date, interval '1 day') d ORDER BY d`,
        [addresses],
      ),
      db.query(
        `SELECT COALESCE(sum(c.commission_e6), 0) AS gross,
           COALESCE(sum(c.commission_e6 * c.platform_tokens / NULLIF(c.creator_tokens + c.platform_tokens, 0)), 0) AS platform
         FROM commission_settlements c WHERE c.bucket = ANY($1)`,
        [addresses],
      ),
      db.query(`SELECT ts, commission_e6 FROM commission_settlements WHERE bucket = ANY($1) ORDER BY ts DESC LIMIT 1`, [addresses]),
      db.query(
        `SELECT (SELECT count(*) FROM link_clicks WHERE slug = ANY($1)) AS clicks,
           (SELECT count(DISTINCT (ip_hash, ua_hash)) FROM link_clicks WHERE slug = ANY($1)) AS visitors,
           (SELECT count(*) FROM backer_attributions WHERE bucket = ANY($2) AND via_link) AS via_link,
           (SELECT count(*) FROM backer_attributions a WHERE a.bucket = ANY($2) AND a.via_link
              AND EXISTS (SELECT 1 FROM positions p WHERE p.wallet = a.wallet AND p.bucket = a.bucket AND p.paid_total_e6 > 0)) AS deposited`,
        [slugs, addresses],
      ),
    ]);
    const gross = big(commission.rows[0].gross);
    const platform = big(commission.rows[0].platform);
    const f = funnel.rows[0];
    return {
      buckets: summaries,
      backersByDay: byDay.rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), newBackers: Number(r.new_backers), depositsUsd: usd(big(r.deposits)) })),
      commission: {
        grossUsd: usd(gross),
        platformShareUsd: usd(platform),
        creatorShareUsd: usd(gross - platform),
        lastSettlement: last.rows[0] ? { at: last.rows[0].ts.toISOString(), amountUsd: usd(big(last.rows[0].commission_e6)) } : null,
      },
      funnel: { linkClicks: Number(f.clicks), uniqueVisitors: Number(f.visitors), signedInFromLink: Number(f.via_link), deposited: Number(f.deposited) },
    };
  });

  app.post('/v1/me/notifications', { config: ctx.writeLimit }, async (req) => {
    const user = await ctx.requireUser(req);
    const body = parse(
      z
        .object({
          email: z.email().max(254).nullish(),
          telegramChatId: z.string().regex(/^-?\d{1,20}$/, 'must be a numeric Telegram chat id').nullish(),
        })
        .refine((b) => b.email !== undefined || b.telegramChatId !== undefined, 'Provide email or telegramChatId'),
      req.body,
    );
    const r = await db.query(
      `UPDATE users SET
         email = CASE WHEN $2 THEN $3 ELSE email END,
         telegram_chat_id = CASE WHEN $4 THEN $5 ELSE telegram_chat_id END,
         updated_at = now()
       WHERE wallet = $1 RETURNING email, telegram_chat_id`,
      [user.wallet, body.email !== undefined, body.email ?? null, body.telegramChatId !== undefined, body.telegramChatId ?? null],
    );
    return { email: r.rows[0]?.email ?? null, telegramChatId: r.rows[0]?.telegram_chat_id ?? null };
  });

  /** In-app notifications (edit proposed / took effect) for the signed-in wallet. */
  app.get('/v1/me/notifications', async (req) => {
    const user = await ctx.requireUser(req);
    const r = await db.query(
      `SELECT n.id, n.kind, n.title, n.body, n.created_at, n.read_at, s.slug FROM notifications n
       LEFT JOIN bucket_slugs s ON s.bucket = n.bucket WHERE n.wallet = $1 ORDER BY n.created_at DESC LIMIT 50`,
      [user.wallet],
    );
    return {
      notifications: r.rows.map((n) => ({
        id: String(n.id),
        kind: n.kind,
        title: n.title,
        body: n.body,
        slug: n.slug,
        createdAt: n.created_at.toISOString(),
        read: n.read_at !== null,
      })),
    };
  });
}
