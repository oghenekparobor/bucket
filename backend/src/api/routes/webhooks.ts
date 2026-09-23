/**
 * POST /v1/webhooks/privy — what Privy pushes to us (docs/architecture.md §3).
 *
 * Privy signs every delivery (svix headers) and retries until it gets a 2xx, so this route
 * verifies the signature with the app's webhook secret, records the delivery id to make retries
 * harmless, and answers quickly. An unverified body is never acted on.
 */
import type { FastifyInstance } from 'fastify';
import { applyPrivyWebhook, type PrivyWebhookEvent } from '../../privy/webhooks.js';
import type { AppContext } from '../app.js';

const header = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/webhooks/privy', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = ctx.cfg.PRIVY_WEBHOOK_SECRET;
    if (!secret || !ctx.privy) {
      return reply.status(503).send({ error: 'not_configured', message: 'Privy webhooks are not configured (PRIVY_WEBHOOK_SECRET)' });
    }
    const id = header(req.headers['svix-id']);
    const timestamp = header(req.headers['svix-timestamp']);
    const signature = header(req.headers['svix-signature']);
    if (!id || !timestamp || !signature) {
      return reply.status(400).send({ error: 'bad_request', message: 'Missing svix-id, svix-timestamp or svix-signature' });
    }
    try {
      await ctx.privy.verifyWebhook(req.body as object, { id, timestamp, signature }, secret);
    } catch {
      req.log.warn({ deliveryId: id }, 'rejected a Privy webhook with an invalid signature');
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid webhook signature' });
    }
    const event = req.body as PrivyWebhookEvent;
    const outcome = await applyPrivyWebhook(ctx.db, id, event);
    req.log.info({ deliveryId: id, type: event?.type, outcome }, 'privy webhook');
    return { ok: true, outcome };
  });
}
