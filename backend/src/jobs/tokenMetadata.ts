/**
 * Backfills Metaplex metadata for bucket tokens that have none.
 *
 * Publishing includes a metadata transaction, but it is the last one in the batch and the creator
 * has to sign it, so it is the one most likely to expire or be abandoned — and a bucket token
 * without metadata shows up as an unknown token in every wallet, explorer and DEX. This job signs as
 * keeper, which the program allows precisely so a failed metadata transaction needs no human.
 *
 * Buckets created before the program gained the instruction are covered by the same pass.
 */
import type { SdkChainGateway } from '../chain/sdkGateway.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';

/** Kept small: each one is a transaction, and a stalled RPC should not hold the worker for minutes. */
const PER_RUN = 10;

export interface TokenMetadataResult {
  checked: number;
  created: number;
  failed: number;
}

export async function runTokenMetadata(db: Db, gateway: SdkChainGateway, perRun = PER_RUN): Promise<TokenMetadataResult> {
  const rows = await db.query<{ address: string; token_mint: string; name: string }>(
    `SELECT address, token_mint, name FROM buckets WHERE status <> 'closed' AND token_mint IS NOT NULL ORDER BY created_at`,
  );
  const result: TokenMetadataResult = { checked: 0, created: 0, failed: 0 };

  for (const row of rows.rows) {
    if (result.created + result.failed >= perRun) break;
    result.checked += 1;
    try {
      // Returns null when the metadata account already exists, which is the common case.
      const signature = await gateway.ensureTokenMetadata({ bucket: row.address, tokenMint: row.token_mint });
      if (signature) {
        result.created += 1;
        logger.info({ component: 'token-metadata', bucket: row.address, name: row.name, signature }, 'created token metadata');
      }
    } catch (err) {
      result.failed += 1;
      // Left for the next run: a bucket without metadata is ugly, never broken.
      logger.warn({ component: 'token-metadata', bucket: row.address, err: (err as Error).message }, 'could not create token metadata');
    }
  }
  return result;
}
