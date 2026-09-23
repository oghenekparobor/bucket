/** API process entry point: `pnpm --filter @bucket/backend dev` (watch) or `start` (built). */
import { PrivyClient } from '@privy-io/server-auth';
import { buildApp } from './api/app.js';
import { BucketAuthenticator } from './api/auth.js';
import { createGateway } from './chain/index.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { logger } from './logger.js';

const db = createPool();
await migrate(db, (m) => logger.info(m));

const privy = config.PRIVY_APP_ID && config.PRIVY_APP_SECRET ? new PrivyClient(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET) : null;
if (config.AUTH_MODE === 'privy' && !privy) logger.warn('AUTH_MODE=privy but PRIVY_APP_ID / PRIVY_APP_SECRET are not set: every write will be rejected');

const app = await buildApp({
  db,
  gateway: createGateway(config, db),
  auth: new BucketAuthenticator(db, { devMode: config.AUTH_MODE === 'dev', devMaxAgeSecs: config.DEV_AUTH_MAX_AGE_SECS, privy }),
  privy,
});
if (privy && !config.PRIVY_WEBHOOK_SECRET) {
  logger.info('PRIVY_WEBHOOK_SECRET is not set: POST /v1/webhooks/privy will answer 503 and profile changes will only sync when a user next signs in');
}

await app.listen({ host: config.HOST, port: config.PORT });

const stop = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
