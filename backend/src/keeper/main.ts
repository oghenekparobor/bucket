/** Keeper process entry point: `pnpm --filter @bucket/backend keeper`. */
import { Alerter } from '../alerts.js';
import { createGateway } from '../chain/index.js';
import { resolveKeypair } from '../chain/keys.js';
import { config } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { logger } from '../logger.js';
import { Keeper } from './keeper.js';

const BALANCE_CHECK_MS = 10 * 60_000;
/** Session advisory lock: one active keeper; standbys wait and take over when its connection drops. */
const KEEPER_LEASE = 0x6b656570; // 'keep'
const log = logger.child({ component: 'keeper' });
const db = createPool();
await migrate(db);

const keeper = new Keeper({
  db,
  gateway: createGateway(config, db),
  alerts: new Alerter(db, log, config.ALERT_WEBHOOK_URL),
  log,
  cfg: config,
  wallets: {
    keeper: resolveKeypair(config.KEEPER_KEYPAIR, config.KEEPER_KEYPAIR_PATH, 'KEEPER')?.publicKey.toBase58() ?? null,
    feePayer: resolveKeypair(config.FEE_PAYER_KEYPAIR, config.FEE_PAYER_KEYPAIR_PATH, 'FEE_PAYER')?.publicKey.toBase58() ?? null,
  },
});

// POST /v1/tx/submit sends NOTIFY keeper_nudge so fills start without waiting a full interval.
let wake: () => void = () => undefined;
const listener = await db.connect();
await listener.query('LISTEN keeper_nudge');
listener.on('notification', () => wake());

let running = true;
const stop = () => {
  running = false;
  wake();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// The lease lives on the LISTEN connection, so it is held exactly as long as this process is up.
let announcedStandby = false;
while (running) {
  const { rows } = await listener.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [KEEPER_LEASE]);
  if (rows[0]?.ok) break;
  if (!announcedStandby) {
    log.info('another keeper holds the lease; standing by');
    announcedStandby = true;
  }
  await new Promise((r) => setTimeout(r, config.KEEPER_INTERVAL_MS));
}

log.info({ intervalMs: config.KEEPER_INTERVAL_MS, cluster: config.CLUSTER, programId: config.PROGRAM_ID }, 'keeper started');
let lastBalanceCheck = 0;
while (running) {
  try {
    const report = await keeper.tick();
    if (report.mintLegs || report.redeemLegs || report.closed || report.settled || report.activated || report.rebalances || report.errors) {
      log.info(report, 'keeper tick');
    }
    if (Date.now() - lastBalanceCheck > BALANCE_CHECK_MS) {
      lastBalanceCheck = Date.now();
      await keeper.checkBalances();
    }
  } catch (err) {
    log.error({ err: (err as Error).message }, 'keeper tick crashed');
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, config.KEEPER_INTERVAL_MS);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}
listener.release();
await db.end();
log.info('keeper stopped');
