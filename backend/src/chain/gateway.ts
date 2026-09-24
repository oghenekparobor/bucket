/**
 * The only door from the backend to the bucket_vault program; implemented with @bucket/sdk in
 * sdkGateway.ts. Routes, the keeper and the price pusher depend on this interface, so tests can swap in
 * a fake.
 */

/** A chain operation that cannot run in this deployment (missing key, deployment file or cluster support). */
export class ChainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainUnavailableError';
  }
}

export interface HoldingInput {
  mint: string;
  weightBps: number;
}

export interface OpenOrder {
  kind: 'mint' | 'redeem';
  address: string;
  bucket: string;
  owner: string; // backer or holder
  legs: { leg: number; done: boolean }[];
  expired: boolean;
}

/** An Asset account (the on-chain allow-list entry and its price feed). */
export interface ProgramAsset {
  mint: string;
  symbol: string;
  source: string;
  assetType: string;
  decimals: number;
  tokenProgram: string;
  enabled: boolean;
  flagged: boolean;
  extraCostBps: number;
  priceE6: bigint;
  lastPriceTs: number;
}

export interface RebalanceTrade {
  bucket: string;
  fromMint: string;
  toMint: string;
  qtyIn: bigint;
}

export interface BuiltCreate {
  /** Base64 v0 transactions, fee-payer signed, to be signed by the creator and sent in order. */
  transactions: string[];
  bucket: string;
  lookupTable: string;
  /** The creator's first mint order, opened by the last transaction. */
  order: string;
  /**
   * Indices of transactions whose failure must not fail the publish. Today that is the token
   * metadata transaction: it is last on purpose, and the keeper backfills it if it does not land.
   * Everything else in the batch is the bucket itself and the creator's money.
   */
  optional: number[];
}

export interface ChainGateway {
  /**
   * Publish flow: vault ATAs, create_bucket, the bucket's lookup table and the creator's first open_mint.
   * Mint builders charge `rent_fee_e6` when the fee payer creates the backer's bucket-token account.
   */
  buildCreateBucketTxs(p: { creator: string; name: string; thesis: string; holdings: HoldingInput[]; stakeE6: bigint }): Promise<BuiltCreate>;
  buildMintTx(p: { backer: string; bucket: string; amountE6: bigint }): Promise<{ transaction: string; order: string }>;
  buildRedeemTx(p: { holder: string; bucket: string; tokens: bigint }): Promise<{ transaction: string; order: string }>;
  buildCloseBucketTx(p: { creator: string; bucket: string }): Promise<{ transaction: string }>;
  buildUpdateInfoTx(p: { creator: string; bucket: string; name: string; thesis: string }): Promise<{ transaction: string }>;
  buildProposeEditTx(p: { creator: string; bucket: string; holdings: HoldingInput[]; note: string | null }): Promise<{ transaction: string }>;
  /** Who pays for a transaction (true when it is the Bucket fee payer) and its bucket_vault instruction names (snake_case). */
  inspectTransaction(transactionBase64: string): { sponsored: boolean; instructions: string[] };
  /** Sends a signed transaction and waits for confirmation. `signer` must sign it unless only the fee payer does. */
  submit(transactionBase64: string, signer: string): Promise<string>;
  /** Every Asset account: the allow-list read straight from chain (does not depend on event history). */
  listProgramAssets(): Promise<ProgramAsset[]>;
  fetchOpenOrders(): Promise<OpenOrder[]>;
  fillMintLeg(order: string, leg: number): Promise<string>;
  closeMintOrder(order: string): Promise<string>;
  fillRedeemLeg(order: string, leg: number): Promise<string>;
  closeRedeemOrder(order: string): Promise<string>;
  settle(bucket: string): Promise<string>;
  activateEdit(bucket: string): Promise<string>;
  /** Settles first (the program checks direction against the last settled value), then swaps. */
  rebalance(trade: RebalanceTrade): Promise<string>;
  /** update_price for each mint (and mock_swap set_price off mainnet), batched a few per transaction. */
  pushPrices(updates: { mint: string; priceE6: bigint }[]): Promise<string[]>;
  /** Devnet/localnet mock USDC faucet. */
  faucet(wallet: string, amountE6: bigint): Promise<string>;
  getWalletBalances(wallet: string): Promise<{ solLamports: bigint; usdcE6: bigint }>;
}
