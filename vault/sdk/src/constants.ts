import { PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { BUCKET_VAULT_IDL } from './idl/bucket_vault.js';
import { MOCK_SWAP_IDL } from './idl/mock_swap.js';

export const BUCKET_VAULT_PROGRAM_ID = new PublicKey(BUCKET_VAULT_IDL.address);
export const MOCK_SWAP_PROGRAM_ID = new PublicKey(MOCK_SWAP_IDL.address);
/** Jupiter aggregator v6 — the mainnet swap venue. */
export const JUPITER_V6_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
/** Mainnet USDC. Devnet uses a mock USDC created by `vault/scripts/devnet-setup.ts`. */
export const MAINNET_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID };

export const SEEDS = {
  config: Buffer.from('config'),
  asset: Buffer.from('asset'),
  creator: Buffer.from('creator'),
  bucket: Buffer.from('bucket'),
  bucketMint: Buffer.from('bucket_mint'),
  creatorFee: Buffer.from('creator_fee'),
  platformFee: Buffer.from('platform_fee'),
  mintOrder: Buffer.from('mint_order'),
  redeemOrder: Buffer.from('redeem_order'),
  // mock_swap
  mockState: Buffer.from('state'),
  mockMarket: Buffer.from('market'),
  mockAuthority: Buffer.from('mint_authority'),
} as const;

export const BUCKET_DECIMALS = 6;
export const ONE_TOKEN = 1_000_000n;
export const USD = 1_000_000n;
export const BPS = 10_000n;
export const INITIAL_UNIT_PRICE_E6 = 100_000_000n;
export const LEG_DUST_E6 = 10_000n;
export const MAX_RENT_FEE_E6 = 1_000_000n;
export const MAX_HOLDINGS = 15;

export interface VaultParams {
  commissionBps: number;
  platformShareBps: number;
  mintFeeBps: number;
  redeemFeeBps: number;
  minCreatorDepositE6: bigint;
  minDepositE6: bigint;
  minHoldings: number;
  maxHoldings: number;
  minWeightBps: number;
  maxWeightPublicBps: number;
  maxWeightPreIpoBps: number;
  maxActiveBuckets: number;
  maxSlippageBps: number;
  vaultCapE6: bigint;
  orderTtlSecs: number;
  maxPriceAgeSecs: number;
  maxPriceMoveBps: number;
  twapWindowSecs: number;
  editDelaySecs: number;
  editCooldownSecs: number;
  mintsPaused: boolean;
}

/** Spec defaults (docs/product-v2.md). Phase 0 decisions may change these in Config. */
export const DEFAULT_PARAMS: Readonly<VaultParams> = {
  commissionBps: 2_000,
  platformShareBps: 2_000,
  mintFeeBps: 20,
  redeemFeeBps: 0,
  minCreatorDepositE6: 25n * USD,
  minDepositE6: 1n * USD,
  minHoldings: 2,
  maxHoldings: 15,
  minWeightBps: 200,
  maxWeightPublicBps: 5_000,
  maxWeightPreIpoBps: 2_500,
  maxActiveBuckets: 5,
  maxSlippageBps: 100,
  vaultCapE6: 0n,
  orderTtlSecs: 600,
  maxPriceAgeSecs: 3_600,
  maxPriceMoveBps: 2_000,
  twapWindowSecs: 1_800,
  editDelaySecs: 86_400,
  editCooldownSecs: 604_800,
  mintsPaused: false,
};
