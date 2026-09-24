import { Connection, PublicKey } from '@solana/web3.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { resolveKeypair } from './keys.js';
import { SdkChainGateway } from './sdkGateway.js';

/** The gateway for the configured cluster, with whichever role keys are available. */
export function createGateway(cfg: Config, db: Queryable): SdkChainGateway {
  return new SdkChainGateway({
    connection: new Connection(cfg.RPC_URL, 'confirmed'),
    programId: new PublicKey(cfg.PROGRAM_ID),
    usdcMint: new PublicKey(cfg.USDC_MINT),
    mainnet: cfg.CLUSTER === 'mainnet-beta',
    mockSwapProgramId: cfg.deployment ? new PublicKey(cfg.deployment.programs.mockSwap) : null,
    keys: {
      feePayer: resolveKeypair(cfg.FEE_PAYER_KEYPAIR, cfg.FEE_PAYER_KEYPAIR_PATH, 'FEE_PAYER'),
      keeper: resolveKeypair(cfg.KEEPER_KEYPAIR, cfg.KEEPER_KEYPAIR_PATH, 'KEEPER'),
      priceAuthority: resolveKeypair(cfg.PRICE_AUTHORITY_KEYPAIR, cfg.PRICE_AUTHORITY_KEYPAIR_PATH, 'PRICE_AUTHORITY'),
    },
    metadataUri: (bucket) => `${cfg.PUBLIC_API_URL.replace(/\/$/, '')}/v1/buckets/${bucket}/token.json`,
    lookupTableOf: async (bucket) =>
      (await db.query<{ lookup_table: string }>('SELECT lookup_table FROM bucket_chain WHERE bucket = $1', [bucket])).rows[0]?.lookup_table ?? null,
    solPriceUsd: async () => {
      const r = await db.query<{ value: number }>(`SELECT value FROM kv WHERE key = 'sol_price_usd'`);
      return r.rows[0] ? Number(r.rows[0].value) : null;
    },
  });
}
