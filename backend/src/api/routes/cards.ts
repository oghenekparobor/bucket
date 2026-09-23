/**
 * Card images: GET /og/b/:slug.png (1200×630 share preview) and GET /og/pnl/:slug.png (1080×1350 PnL
 * card). Rendered PNGs are cached in memory for CARD_CACHE_TTL_SECS and served with the same max-age.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TtlCache } from '../../cards/cache.js';
import { pnlCardData, previewCardData } from '../../cards/data.js';
import { pnlCard, previewCard } from '../../cards/layouts.js';
import { renderPng } from '../../cards/render.js';
import { PERIODS, type Period } from '../../util/time.js';
import type { AppContext } from '../app.js';
import { notFound, parse } from '../errors.js';

const pngParam = z.object({ file: z.string().regex(/^[a-z0-9-]{1,64}\.png$|^[1-9A-HJ-NP-Za-km-z]{32,44}\.png$/, 'expected <slug>.png') });

export function registerCardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cache = new TtlCache<Buffer>(ctx.cfg.CARD_CACHE_TTL_SECS * 1000);
  const send = (reply: FastifyReply, png: Buffer) =>
    reply.header('content-type', 'image/png').header('cache-control', `public, max-age=${ctx.cfg.CARD_CACHE_TTL_SECS}`).send(png);

  app.get('/og/b/:file', async (req, reply) => {
    const slug = parse(pngParam, req.params).file.replace(/\.png$/, '');
    const key = `b:${slug}`;
    const hit = cache.get(key);
    if (hit) return send(reply, hit);
    const data = await previewCardData(ctx.db, slug);
    if (!data) throw notFound('Bucket');
    const png = await renderPng(previewCard(data), 1200, 630);
    cache.set(key, png);
    return send(reply, png);
  });

  app.get('/og/pnl/:file', async (req, reply) => {
    const slug = parse(pngParam, req.params).file.replace(/\.png$/, '');
    const q = parse(
      z.object({
        period: z.enum(PERIODS as [Period, ...Period[]]).default('30d'),
        wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(),
        dollars: z.enum(['0', '1']).default('0'),
      }),
      req.query,
    );
    const key = `pnl:${slug}:${q.period}:${q.wallet ?? ''}:${q.dollars}`;
    const hit = cache.get(key);
    if (hit) return send(reply, hit);
    const data = await pnlCardData(ctx.db, slug, { period: q.period, wallet: q.wallet ?? null, showDollars: q.dollars === '1' });
    if (!data) throw notFound('Bucket');
    const png = await renderPng(pnlCard(data), 1080, 1350);
    cache.set(key, png);
    return send(reply, png);
  });
}
