/**
 * One keeper pass for cron mode: take the keeper lease if it is free, fill what is fillable, run
 * the token-metadata backfill, release. A long-running keeper holds the lease on its LISTEN
 * connection for as long as it is up, so this pass steps aside while one exists — there are never
 * two keepers acting at once.
 */
import { Alerter } from '../alerts.js';
import { createGateway } from '../chain/index.js';
import { resolveKeypair } from '../chain/keys.js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { runTokenMetadata, type TokenMetadataResult } from '../jobs/tokenMetadata.js';
import { logger } from '../logger.js';
import { Keeper, type TickReport } from './keeper.js';

/** Session advisory lock: one active keeper; standbys wait and take over when its connection drops. */
export const KEEPER_LEASE = 0x6b656570; // 'keep'

export type KeeperOnceReport = { skipped: 'lease_held' } | { tick: TickReport; metadata: TokenMetadataResult };

export async function runKeeperOnce(db: Db): Promise<KeeperOnceReport> {
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [KEEPER_LEASE]);
    if (!rows[0]?.ok) return { skipped: 'lease_held' };
    try {
      const log = logger.child({ component: 'keeper-once' });
      const gateway = createGateway(config, db);
      const keeper = new Keeper({
        db,
        gateway,
        alerts: new Alerter(db, log, config.ALERT_WEBHOOK_URL),
        log,
        cfg: config,
        wallets: {
          keeper: resolveKeypair(config.KEEPER_KEYPAIR, config.KEEPER_KEYPAIR_PATH, 'KEEPER')?.publicKey.toBase58() ?? null,
          feePayer: resolveKeypair(config.FEE_PAYER_KEYPAIR, config.FEE_PAYER_KEYPAIR_PATH, 'FEE_PAYER')?.publicKey.toBase58() ?? null,
        },
      });
      const tick = await keeper.tick();
      const metadata = await runTokenMetadata(db, gateway);
      return { tick, metadata };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [KEEPER_LEASE]);
    }
  } finally {
    client.release();
  }
}
