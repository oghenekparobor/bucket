/**
 * Fastify app for the Bucket API (docs/architecture.md §3). Public reads need no auth; every write
 * goes through `requireUser` and is rate limited.
 */
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { ChainGateway } from '../chain/gateway.js';
import { ChainUnavailableError } from '../chain/gateway.js';
import { TxFailedError, TxRejectedError } from '../chain/sdkGateway.js';
import { type Config, config as defaultConfig, webOrigins } from '../config.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import type { AuthUser, Authenticator } from './auth.js';
import { HttpError } from './errors.js';
import { assertGeoAllowed, isRestricted, loadGeoPolicy, locate } from './geo.js';
import { registerCardRoutes } from './routes/cards.js';
import { registerMeRoutes } from './routes/me.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerTxRoutes } from './routes/tx.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

/** The slice of the Privy client the webhook route needs (mockable in tests). */
export interface PrivyWebhookVerifier {
  verifyWebhook(payload: object, headers: { id: string; timestamp: string; signature: string }, secret: string): Promise<unknown>;
}

export interface AppDeps {
  db: Db;
  gateway: ChainGateway;
  auth: Authenticator;
  cfg?: Config;
  /** Verifies Privy webhook signatures; null when Privy is not configured. */
  privy?: PrivyWebhookVerifier | null;
}

export interface AppContext extends Required<Omit<AppDeps, 'privy'>> {
  privy: PrivyWebhookVerifier | null;
  requireUser(req: FastifyRequest): Promise<AuthUser>;
  /** Throws 451 when the request's location may not do this (pre-IPO = bucket holds a pre-IPO token). */
  assertGeo(req: FastifyRequest, preIpo: boolean): void;
  /** Whether the request's location is restricted for any bucket. */
  geoRestricted(req: FastifyRequest): boolean;
  writeLimit: { rateLimit: { max: number; timeWindow: string } };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const cfg = deps.cfg ?? defaultConfig;
  const app: FastifyInstance = Fastify({ loggerInstance: logger as FastifyBaseLogger, trustProxy: true, bodyLimit: 256 * 1024 });

  await app.register(cors, {
    origin: webOrigins(cfg),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-bucket-wallet'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => `${req.ip}:${(req.headers.authorization ?? '').slice(-24)}`,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ChainUnavailableError) return reply.status(503).send({ error: 'chain_unavailable', message: err.message });
    if (err instanceof TxRejectedError) return reply.status(400).send({ error: 'tx_rejected', message: err.message });
    if (err instanceof TxFailedError) {
      return reply.status(422).send({ error: 'tx_failed', message: err.message, details: { signature: err.signature, logs: err.logs.slice(-8) } });
    }
    // Program / RPC errors while building (e.g. unknown bucket account) are the client's to fix.
    if ((err as Error).name === 'AccountNotFoundError' || /Account does not exist/.test((err as Error).message)) {
      return reply.status(404).send({ error: 'not_found', message: (err as Error).message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal', message: 'Internal error' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Route not found' }));

  const geoPolicy = loadGeoPolicy();
  const geoHeaders = { country: cfg.GEO_COUNTRY_HEADERS.split(','), region: cfg.GEO_REGION_HEADERS.split(',') };
  const ctx: AppContext = {
    ...deps,
    cfg,
    privy: deps.privy ?? null,
    assertGeo: (req, preIpo) => assertGeoAllowed(req, geoPolicy, geoHeaders, preIpo),
    geoRestricted: (req) => isRestricted(geoPolicy, locate(req, geoHeaders)),
    requireUser: (req) => {
      const hint = req.headers['x-bucket-wallet'];
      return deps.auth.authenticate(req.headers.authorization, typeof hint === 'string' ? hint : undefined);
    },
    writeLimit: { rateLimit: { max: cfg.WRITE_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } },
  };
  registerPublicRoutes(app, ctx);
  registerMeRoutes(app, ctx);
  registerTxRoutes(app, ctx);
  registerCardRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
  return app;
}
