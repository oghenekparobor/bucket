import { Connection, PublicKey } from '@solana/web3.js';
import { Alerter } from '../alerts.js';
import { createDecoder } from '../indexer/decode.js';
import { ChainIndexer } from '../indexer/poller.js';
import { createGateway } from '../chain/index.js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';
import { channelsFromConfig } from '../notify/channels.js';
import { dispatchPending } from '../notify/dispatcher.js';
import { pushPrices } from '../prices/pricePusher.js';
import { recomputeEligibility } from '../catalog/repo.js';
import { runTokenMetadata } from './tokenMetadata.js';
import { prunePrivyWebhooks } from '../privy/webhooks.js';
import { runCatalogSync, runPriceSync, eligibilityRules } from './catalogSync.js';
import { runDeadlineAlerts } from './deadlineAlerts.js';
import { runLeaderboard } from './leaderboard.js';
import { refreshBuckets, runPerformance } from './performance.js';
import { JupiterPoolPriceSource, runPoolMonitor } from './poolMonitor.js';
import { runRoutingProbe } from './routingProbe.js';
import { recordJob } from './runner.js';

type JobFn = (db: Db) => Promise<unknown>;

/** The chain indexer for the configured program (worker loop and `runJob indexer`). */
export function createIndexer(db: Db): ChainIndexer {
  const programId = new PublicKey(config.PROGRAM_ID);
  return new ChainIndexer(
    db,
    new Connection(config.RPC_URL, 'confirmed'),
    config.PROGRAM_ID,
    createDecoder(programId),
    () => ({ platformWallet: config.PLATFORM_FEE_WALLET, nowMs: Date.now() }),
    logger.child({ component: 'indexer' }),
    // Mints, redeems and settlements change unit price, total backed and holders: refresh those buckets now.
    (buckets) => refreshBuckets(db, buckets),
    // A mint listed on chain is eligible (or not) the moment it appears, not at the next price sync.
    async () => {
      await recomputeEligibility(db, eligibilityRules(config));
    },
  );
}

/** Every background job, runnable by name from the CLI (`scripts/runJob.ts`) and scheduled by the worker. */
export const JOBS: Record<string, JobFn> = {
  indexer: (db) => createIndexer(db).pollOnce(),
  catalog: (db) => runCatalogSync(db),
  prices: (db) => runPriceSync(db),
  performance: (db) => runPerformance(db),
  leaderboard: (db) => runLeaderboard(db),
  'routing-probe': (db) => runRoutingProbe(db, { minLiquidityUsd: 10_000 }),
  'pool-monitor': (db) => runPoolMonitor(db, new JupiterPoolPriceSource(), new Alerter(db, logger, config.ALERT_WEBHOOK_URL)),
  'deadline-alerts': (db) => runDeadlineAlerts(db, new Alerter(db, logger, config.ALERT_WEBHOOK_URL)),
  notifications: (db) => dispatchPending(db, channelsFromConfig(config, logger), { publicWebUrl: config.PUBLIC_WEB_URL }),
  // update_price for every allow-listed mint (off mainnet: mirrored into mock mints and mock_swap markets).
  'price-push': (db) => pushPrices(db, createGateway(config, db), config.deployment),
  // Bucket tokens with no Metaplex metadata show as unknown tokens in wallets; signs as keeper.
  'token-metadata': (db) => runTokenMetadata(db, createGateway(config, db)),
  // Webhook payloads are kept only for debugging.
  'privy-webhook-prune': (db) => prunePrivyWebhooks(db).then((deleted) => ({ deleted })),
};

export function runJobByName(db: Db, name: string): Promise<unknown> {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown job "${name}". Known: ${Object.keys(JOBS).join(', ')}`);
  return recordJob(db, name, () => job(db));
}
