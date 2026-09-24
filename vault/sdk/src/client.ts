// BucketClient: typed account fetchers and instruction builders for every
// bucket_vault instruction, plus the multi-instruction flows the app runs
// (publish, invest, exit). Builders never sign or send; callers decide who
// pays and who signs, so the same code serves the backend (sponsored fees),
// the keeper, and a user running with an exported key and no Bucket service.

import { BorshCoder, EventParser, Program, type IdlAccounts, type IdlTypes } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  AccountMeta,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { BUCKET_VAULT_PROGRAM_ID, DEFAULT_PARAMS, TOKEN_METADATA_PROGRAM_ID, type VaultParams } from './constants.js';
import { BUCKET_VAULT_IDL, type BucketVault } from './idl/bucket_vault.js';
import { type HoldingState } from './math.js';
import { newNonce, Pdas } from './pda.js';
import { readonlyProvider, type SwapAdapter } from './swap.js';

export type ConfigAccount = IdlAccounts<BucketVault>['config'];
export type AssetAccount = IdlAccounts<BucketVault>['asset'];
export type BucketAccount = IdlAccounts<BucketVault>['bucket'];
export type CreatorStateAccount = IdlAccounts<BucketVault>['creatorState'];
export type MintOrderAccount = IdlAccounts<BucketVault>['mintOrder'];
export type RedeemOrderAccount = IdlAccounts<BucketVault>['redeemOrder'];
export type ConfigParams = IdlTypes<BucketVault>['configParams'];
export type Roles = IdlTypes<BucketVault>['roles'];

export type Source = 'xStocks' | 'preStocks' | 'tessera';
export type AssetKind = 'publicStock' | 'etf' | 'preIpo';

const bn = (x: bigint | number) => new BN(x.toString());
const big = (x: BN | number) => BigInt(x.toString());
const enumKey = (e: object) => Object.keys(e)[0]!;

/** Spec defaults as the Anchor-encoded `ConfigParams` struct. */
export function defaultConfigParams(overrides: Partial<VaultParams> = {}): ConfigParams {
  const p = { ...DEFAULT_PARAMS, ...overrides };
  return {
    commissionBps: p.commissionBps,
    platformShareBps: p.platformShareBps,
    mintFeeBps: p.mintFeeBps,
    redeemFeeBps: p.redeemFeeBps,
    minCreatorDepositE6: bn(p.minCreatorDepositE6),
    minDepositE6: bn(p.minDepositE6),
    minHoldings: p.minHoldings,
    maxHoldings: p.maxHoldings,
    minWeightBps: p.minWeightBps,
    maxWeightPublicBps: p.maxWeightPublicBps,
    maxWeightPreIpoBps: p.maxWeightPreIpoBps,
    maxActiveBuckets: p.maxActiveBuckets,
    maxSlippageBps: p.maxSlippageBps,
    vaultCapE6: bn(p.vaultCapE6),
    orderTtlSecs: bn(p.orderTtlSecs),
    maxPriceAgeSecs: bn(p.maxPriceAgeSecs),
    maxPriceMoveBps: p.maxPriceMoveBps,
    twapWindowSecs: bn(p.twapWindowSecs),
    editDelaySecs: bn(p.editDelaySecs),
    editCooldownSecs: bn(p.editCooldownSecs),
    mintsPaused: p.mintsPaused,
  };
}

/** Solana's transaction size limit, and how many lookup-table addresses fit in one extend. */
export const MAX_TX_BYTES = 1232;
export const ADDRESSES_PER_EXTEND = 24;

export interface BuiltFlow {
  ixs: TransactionInstruction[];
  /** Lookup tables the transaction needs (swap venue tables). */
  lookupTables?: PublicKey[];
}

export class BucketClient {
  readonly program: Program<BucketVault>;
  readonly pdas: Pdas;
  readonly programId: PublicKey;

  constructor(
    readonly connection: Connection,
    opts: { programId?: PublicKey } = {},
  ) {
    this.programId = opts.programId ?? BUCKET_VAULT_PROGRAM_ID;
    const idl = { ...BUCKET_VAULT_IDL, address: this.programId.toBase58() } as BucketVault;
    this.program = new Program<BucketVault>(idl, readonlyProvider(connection));
    this.pdas = new Pdas(this.programId);
  }

  // ------------------------------------------------------------ fetchers

  config = () => this.program.account.config.fetch(this.pdas.config());
  bucket = (address: PublicKey) => this.program.account.bucket.fetch(address);
  asset = (mint: PublicKey) => this.program.account.asset.fetch(this.pdas.asset(mint));
  mintOrder = (address: PublicKey) => this.program.account.mintOrder.fetch(address);
  redeemOrder = (address: PublicKey) => this.program.account.redeemOrder.fetch(address);
  creatorState = (creator: PublicKey) => this.program.account.creatorState.fetchNullable(this.pdas.creatorState(creator));

  async assets(mints: PublicKey[]): Promise<AssetAccount[]> {
    const res = await this.program.account.asset.fetchMultiple(mints.map((m) => this.pdas.asset(m)));
    return res.map((a, i) => {
      if (!a) throw new Error(`asset ${mints[i]!.toBase58()} is not in the catalog`);
      return a;
    });
  }

  allAssets = () => this.program.account.asset.all();
  allBuckets = () => this.program.account.bucket.all();
  openMintOrders = () => this.program.account.mintOrder.all();
  openRedeemOrders = () => this.program.account.redeemOrder.all();

  /** Vault balances and prices for every holding entry, in bucket order. */
  async holdingStates(bucketAddress: PublicKey, bucket: BucketAccount): Promise<HoldingState[]> {
    const assets = await this.assets(bucket.holdings.map((h) => h.mint));
    const vaults = await this.connection.getMultipleAccountsInfo(bucket.holdings.map((h) => h.vault));
    return bucket.holdings.map((h, i) => {
      const data = vaults[i]?.data;
      const balance = data ? data.readBigUInt64LE(64) : 0n;
      return {
        mint: h.mint.toBase58(),
        decimals: h.decimals,
        weightBps: h.weightBps,
        balance,
        reserved: big(h.reserved),
        priceE6: big(assets[i]!.priceE6),
        twapE6: big(assets[i]!.twapE6),
      };
    });
  }

  async supply(bucket: BucketAccount): Promise<bigint> {
    const s = await this.connection.getTokenSupply(bucket.tokenMint);
    return BigInt(s.value.amount);
  }

  // ------------------------------------------------------------ account lists

  /** `[asset_i, vault_i]` for every holding entry: the remaining accounts of open_mint, redeem and settle. */
  holdingAccounts(bucket: BucketAccount): AccountMeta[] {
    return bucket.holdings.flatMap((h) => [
      { pubkey: this.pdas.asset(h.mint), isSigner: false, isWritable: false },
      { pubkey: h.vault, isSigner: false, isWritable: false },
    ]);
  }

  /** Every static account a bucket's transactions touch; put these in the bucket's lookup table. */
  lookupTableAddresses(bucketAddress: PublicKey, bucket: BucketAccount, config: ConfigAccount, extra: PublicKey[] = []): PublicKey[] {
    const set = new Map<string, PublicKey>();
    const add = (k: PublicKey) => set.set(k.toBase58(), k);
    [
      this.programId,
      this.pdas.config(),
      bucketAddress,
      bucket.tokenMint,
      this.pdas.creatorFee(bucketAddress),
      this.pdas.platformFee(bucketAddress),
      config.usdcMint,
      getAssociatedTokenAddressSync(config.usdcMint, config.feeWallet, true, TOKEN_PROGRAM_ID),
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      SystemProgram.programId,
      ComputeBudgetProgram.programId,
      ...config.swapPrograms.filter((p) => !p.equals(PublicKey.default)),
      ...bucket.holdings.flatMap((h) => [this.pdas.asset(h.mint), h.vault, h.mint]),
      ...extra,
    ].forEach(add);
    return [...set.values()];
  }

  /**
   * Create + extend instructions for a lookup table. Each extend carries at most
   * `ADDRESSES_PER_EXTEND` addresses (32 bytes each), which keeps an extend inside Solana's
   * 1232-byte transaction limit on its own. Send `create` and each extend as their own
   * transaction: `create` plus a full extend does not fit.
   */
  lookupTableIxs(authority: PublicKey, payer: PublicKey, recentSlot: number, addresses: PublicKey[]) {
    const [create, table] = AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot });
    const extends_: TransactionInstruction[] = [];
    for (let i = 0; i < addresses.length; i += ADDRESSES_PER_EXTEND) {
      extends_.push(
        AddressLookupTableProgram.extendLookupTable({
          authority,
          payer,
          lookupTable: table,
          addresses: addresses.slice(i, i + ADDRESSES_PER_EXTEND),
        }),
      );
    }
    return { table, create, extends: extends_ };
  }

  // ------------------------------------------------------------ admin

  initializeConfigIx(p: { authority: PublicKey; usdcMint: PublicKey; params: ConfigParams; roles: Roles }) {
    const programData = PublicKey.findProgramAddressSync([this.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
    return this.program.methods
      .initializeConfig(p.params, p.roles)
      .accountsPartial({
        authority: p.authority,
        config: this.pdas.config(),
        usdcMint: p.usdcMint,
        program: this.programId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  updateConfigIx(admin: PublicKey, params: ConfigParams) {
    return this.program.methods.updateConfig(params).accountsPartial({ admin, config: this.pdas.config() }).instruction();
  }

  setRolesIx(admin: PublicKey, roles: Roles) {
    return this.program.methods.setRoles(roles).accountsPartial({ admin, config: this.pdas.config() }).instruction();
  }

  addAssetIx(p: { admin: PublicKey; mint: PublicKey; source: Source; kind: AssetKind; symbol: string; extraCostBps: number; priceE6: bigint }) {
    return this.program.methods
      .addAsset({ [p.source]: {} } as never, { [p.kind]: {} } as never, p.symbol, p.extraCostBps, bn(p.priceE6))
      .accountsPartial({
        admin: p.admin,
        config: this.pdas.config(),
        mint: p.mint,
        asset: this.pdas.asset(p.mint),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  setAssetStatusIx(p: { admin: PublicKey; mint: PublicKey; enabled: boolean; flagged: boolean; extraCostBps: number }) {
    return this.program.methods
      .setAssetStatus(p.enabled, p.flagged, p.extraCostBps)
      .accountsPartial({ admin: p.admin, config: this.pdas.config(), asset: this.pdas.asset(p.mint) })
      .instruction();
  }

  updatePriceIx(signer: PublicKey, mint: PublicKey, priceE6: bigint, force = false) {
    const m = force ? this.program.methods.forcePrice(bn(priceE6)) : this.program.methods.updatePrice(bn(priceE6));
    return m.accountsPartial({ signer, config: this.pdas.config(), asset: this.pdas.asset(mint) }).instruction();
  }

  // ------------------------------------------------------------ publish

  /**
   * Publish flow step 1: the vault ATAs (creator or fee payer pays rent) and
   * `create_bucket`. Split into two transactions if 15 ATAs do not fit one.
   */
  async createBucketFlow(p: {
    creator: PublicKey;
    payer: PublicKey;
    name: string;
    thesis: string;
    holdings: { mint: PublicKey; weightBps: number }[];
  }): Promise<{ bucket: PublicKey; bucketMint: PublicKey; id: number; ataIxs: TransactionInstruction[]; createIx: TransactionInstruction }> {
    const cs = await this.creatorState(p.creator);
    const id = cs?.nextBucketId ?? 0;
    const bucket = this.pdas.bucket(p.creator, id);
    const assets = await this.assets(p.holdings.map((h) => h.mint));
    const ataIxs = p.holdings.map((h, i) =>
      createAssociatedTokenAccountIdempotentInstruction(
        p.payer,
        this.pdas.vault(bucket, h.mint, assets[i]!.tokenProgram),
        bucket,
        h.mint,
        assets[i]!.tokenProgram,
      ),
    );
    const bucketMint = this.pdas.bucketMint(bucket);
    const createIx = await this.program.methods
      .createBucket(id, p.name, p.thesis, p.holdings.map((h) => h.weightBps))
      .accountsPartial({
        creator: p.creator,
        payer: p.payer,
        config: this.pdas.config(),
        creatorState: this.pdas.creatorState(p.creator),
        bucket,
        bucketMint,
        creatorFee: this.pdas.creatorFee(bucket),
        platformFee: this.pdas.platformFee(bucket),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(p.holdings.map((h) => ({ pubkey: this.pdas.asset(h.mint), isSigner: false, isWritable: false })))
      .instruction();
    return { bucket, bucketMint, id, ataIxs, createIx };
  }

  /**
   * Metaplex metadata for a bucket's mint — without it the token has no name, ticker or image in any
   * wallet. `authority` must be the bucket's creator or the program admin. `uri` points at the JSON
   * document wallets read for the description and image (the backend serves one per bucket).
   */
  async tokenMetadataIx(p: {
    authority: PublicKey;
    payer: PublicKey;
    bucketAddress: PublicKey;
    tokenMint: PublicKey;
    uri: string;
    /** Rewrite existing metadata instead of creating it (after a rename). */
    update?: boolean;
  }): Promise<TransactionInstruction> {
    const accounts = {
      authority: p.authority,
      payer: p.payer,
      config: this.pdas.config(),
      bucket: p.bucketAddress,
      bucketMint: p.tokenMint,
      metadata: this.pdas.metadata(p.tokenMint),
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    };
    return p.update
      ? this.program.methods.updateTokenMetadata(p.uri).accountsPartial(accounts).instruction()
      : this.program.methods.createTokenMetadata(p.uri).accountsPartial(accounts).instruction();
  }

  updateBucketInfoIx(creator: PublicKey, bucket: PublicKey, name: string, thesis: string) {
    return this.program.methods.updateBucketInfo(name, thesis).accountsPartial({ creator, bucket }).instruction();
  }

  closeBucketIx(creator: PublicKey, bucket: PublicKey) {
    return this.program.methods
      .closeBucket()
      .accountsPartial({ creator, bucket, creatorState: this.pdas.creatorState(creator) })
      .instruction();
  }

  // ------------------------------------------------------------ money in

  async openMintIx(p: {
    backer: PublicKey;
    payer: PublicKey;
    bucketAddress: PublicKey;
    bucket: BucketAccount;
    config: ConfigAccount;
    amountE6: bigint;
    nonce?: bigint;
    /** USDC the sponsor recovers for fronting the backer's new bucket-token account rent (payer ≠ backer, ≤ $1). */
    rentFeeE6?: bigint;
  }) {
    const nonce = p.nonce ?? newNonce();
    const order = this.pdas.mintOrder(p.bucketAddress, p.backer, nonce);
    const usdc = p.config.usdcMint;
    const ix = await this.program.methods
      .openMint(bn(p.amountE6), bn(nonce), bn(p.rentFeeE6 ?? 0n))
      .accountsPartial({
        backer: p.backer,
        payer: p.payer,
        config: this.pdas.config(),
        bucket: p.bucketAddress,
        bucketMint: p.bucket.tokenMint,
        creatorFee: this.pdas.creatorFee(p.bucketAddress),
        platformFee: this.pdas.platformFee(p.bucketAddress),
        usdcMint: usdc,
        backerUsdc: getAssociatedTokenAddressSync(usdc, p.backer, true, TOKEN_PROGRAM_ID),
        feeWalletUsdc: getAssociatedTokenAddressSync(usdc, p.config.feeWallet, true, TOKEN_PROGRAM_ID),
        order,
        escrow: this.pdas.escrow(order, usdc),
        backerBucketAta: getAssociatedTokenAddressSync(p.bucket.tokenMint, p.backer, true, TOKEN_PROGRAM_ID),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.holdingAccounts(p.bucket))
      .instruction();
    return { ix, order, nonce };
  }

  /** Builds one fill for one leg: fetches a route from `swap` for `usdcIn` of the leg's budget. */
  async fillMintIx(p: {
    signer: PublicKey;
    bucketAddress: PublicKey;
    bucket: BucketAccount;
    config: ConfigAccount;
    orderAddress: PublicKey;
    order: MintOrderAccount;
    leg: number;
    usdcIn?: bigint;
    swap: SwapAdapter;
    slippageBps?: number;
  }): Promise<BuiltFlow & { expectedOut: bigint }> {
    const leg = p.order.legs[p.leg];
    if (!leg) throw new Error(`leg ${p.leg} out of range`);
    const holding = p.bucket.holdings.find((h) => h.mint.equals(leg.mint));
    if (!holding) throw new Error(`leg mint ${leg.mint.toBase58()} is no longer a holding`);
    const usdc = p.config.usdcMint;
    const escrow = this.pdas.escrow(p.orderAddress, usdc);
    const usdcIn = p.usdcIn ?? big(leg.budgetE6) - big(leg.spentE6);
    const route = await p.swap.build({
      inputMint: usdc,
      outputMint: leg.mint,
      amountIn: usdcIn,
      authority: p.orderAddress,
      source: escrow,
      destination: holding.vault,
      slippageBps: p.slippageBps ?? p.config.params.maxSlippageBps,
    });
    const ix = await this.program.methods
      .fillMint(p.leg, bn(usdcIn), bn(route.minOut), route.data)
      .accountsPartial({
        signer: p.signer,
        config: this.pdas.config(),
        bucket: p.bucketAddress,
        bucketMint: p.bucket.tokenMint,
        order: p.orderAddress,
        escrow,
        vault: holding.vault,
        asset: this.pdas.asset(leg.mint),
        backerBucketAta: getAssociatedTokenAddressSync(p.bucket.tokenMint, p.order.backer, true, TOKEN_PROGRAM_ID),
        swapProgram: route.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(route.keys)
      .instruction();
    return { ixs: [ix], lookupTables: route.lookupTables, expectedOut: route.expectedOut };
  }

  closeMintOrderIx(p: { signer: PublicKey; config: ConfigAccount; orderAddress: PublicKey; order: MintOrderAccount }) {
    const usdc = p.config.usdcMint;
    return this.program.methods
      .closeMintOrder()
      .accountsPartial({
        signer: p.signer,
        config: this.pdas.config(),
        order: p.orderAddress,
        escrow: this.pdas.escrow(p.orderAddress, usdc),
        backerUsdc: getAssociatedTokenAddressSync(usdc, p.order.backer, true, TOKEN_PROGRAM_ID),
        rentPayer: p.order.rentPayer,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  // ------------------------------------------------------------ money out

  async redeemIx(p: { holder: PublicKey; payer: PublicKey; bucketAddress: PublicKey; bucket: BucketAccount; tokens: bigint; nonce?: bigint }) {
    const nonce = p.nonce ?? newNonce();
    const order = this.pdas.redeemOrder(p.bucketAddress, p.holder, nonce);
    const ix = await this.program.methods
      .redeem(bn(p.tokens), bn(nonce))
      .accountsPartial({
        holder: p.holder,
        payer: p.payer,
        config: this.pdas.config(),
        bucket: p.bucketAddress,
        bucketMint: p.bucket.tokenMint,
        holderBucketAta: getAssociatedTokenAddressSync(p.bucket.tokenMint, p.holder, true, TOKEN_PROGRAM_ID),
        creatorFee: this.pdas.creatorFee(p.bucketAddress),
        platformFee: this.pdas.platformFee(p.bucketAddress),
        order,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.holdingAccounts(p.bucket))
      .instruction();
    return { ix, order, nonce };
  }

  async fillRedeemIx(p: {
    signer: PublicKey;
    bucketAddress: PublicKey;
    bucket: BucketAccount;
    config: ConfigAccount;
    orderAddress: PublicKey;
    order: RedeemOrderAccount;
    leg: number;
    qty?: bigint;
    swap: SwapAdapter;
    slippageBps?: number;
  }): Promise<BuiltFlow & { expectedOut: bigint }> {
    const leg = p.order.legs[p.leg];
    if (!leg) throw new Error(`leg ${p.leg} out of range`);
    const holding = p.bucket.holdings.find((h) => h.mint.equals(leg.mint));
    if (!holding) throw new Error(`leg mint ${leg.mint.toBase58()} is not a holding`);
    const usdc = p.config.usdcMint;
    const holderUsdc = getAssociatedTokenAddressSync(usdc, p.order.holder, true, TOKEN_PROGRAM_ID);
    const qty = p.qty ?? big(leg.qty) - big(leg.sold) - big(leg.claimed);
    const route = await p.swap.build({
      inputMint: leg.mint,
      outputMint: usdc,
      amountIn: qty,
      authority: p.bucketAddress,
      source: holding.vault,
      destination: holderUsdc,
      slippageBps: p.slippageBps ?? p.config.params.maxSlippageBps,
    });
    const ix = await this.program.methods
      .fillRedeem(p.leg, bn(qty), bn(route.minOut), route.data)
      .accountsPartial({
        signer: p.signer,
        config: this.pdas.config(),
        bucket: p.bucketAddress,
        bucketMint: p.bucket.tokenMint,
        order: p.orderAddress,
        vault: holding.vault,
        asset: this.pdas.asset(leg.mint),
        holderUsdc,
        swapProgram: route.programId,
      })
      .remainingAccounts(route.keys)
      .instruction();
    return { ixs: [ix], lookupTables: route.lookupTables, expectedOut: route.expectedOut };
  }

  /** The keeper-free exit: take the unsold slice of a leg as the token itself. Creates the holder's account if needed. */
  async claimInKindIxs(p: { holder: PublicKey; payer: PublicKey; bucketAddress: PublicKey; bucket: BucketAccount; orderAddress: PublicKey; order: RedeemOrderAccount; leg: number }) {
    const leg = p.order.legs[p.leg];
    if (!leg) throw new Error(`leg ${p.leg} out of range`);
    const holding = p.bucket.holdings.find((h) => h.mint.equals(leg.mint));
    if (!holding) throw new Error('leg mint is not a holding');
    const asset = await this.asset(leg.mint);
    const holderToken = getAssociatedTokenAddressSync(leg.mint, p.holder, true, asset.tokenProgram);
    const create = createAssociatedTokenAccountIdempotentInstruction(p.payer, holderToken, p.holder, leg.mint, asset.tokenProgram);
    const ix = await this.program.methods
      .claimRedeemInKind(p.leg)
      .accountsPartial({
        holder: p.holder,
        bucket: p.bucketAddress,
        order: p.orderAddress,
        vault: holding.vault,
        mint: leg.mint,
        holderToken,
        tokenProgram: asset.tokenProgram,
      })
      .instruction();
    return [create, ix];
  }

  closeRedeemOrderIx(orderAddress: PublicKey, order: RedeemOrderAccount) {
    return this.program.methods.closeRedeemOrder().accountsPartial({ order: orderAddress, rentPayer: order.rentPayer }).instruction();
  }

  // ------------------------------------------------------------ commission

  settleIx(bucketAddress: PublicKey, bucket: BucketAccount) {
    return this.program.methods
      .settleCommission()
      .accountsPartial({
        config: this.pdas.config(),
        bucket: bucketAddress,
        bucketMint: bucket.tokenMint,
        creatorFee: this.pdas.creatorFee(bucketAddress),
        platformFee: this.pdas.platformFee(bucketAddress),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(this.holdingAccounts(bucket))
      .instruction();
  }

  /** Claim commission tokens to the creator (`creator: true`) or the platform fee wallet. */
  claimFeesIxs(p: { signer: PublicKey; payer: PublicKey; bucketAddress: PublicKey; bucket: BucketAccount; config: ConfigAccount; creator: boolean }) {
    const recipient = p.creator ? p.bucket.creator : p.config.feeWallet;
    const destination = getAssociatedTokenAddressSync(p.bucket.tokenMint, recipient, true, TOKEN_PROGRAM_ID);
    return Promise.all([
      createAssociatedTokenAccountIdempotentInstruction(p.payer, destination, recipient, p.bucket.tokenMint, TOKEN_PROGRAM_ID),
      this.program.methods
        .claimFees(p.creator)
        .accountsPartial({
          signer: p.signer,
          config: this.pdas.config(),
          bucket: p.bucketAddress,
          feeAccount: p.creator ? this.pdas.creatorFee(p.bucketAddress) : this.pdas.platformFee(p.bucketAddress),
          destination,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    ]);
  }

  // ------------------------------------------------------------ edits (phase 2)

  /** propose_edit plus the vault ATAs of any new holding, paid by `payer` (the creator, per spec). */
  async proposeEditIxs(p: { creator: PublicKey; payer: PublicKey; bucketAddress: PublicKey; bucket: BucketAccount; holdings: { mint: PublicKey; weightBps: number }[]; note: string }) {
    const assets = await this.assets(p.holdings.map((h) => h.mint));
    const ataIxs = p.holdings
      .map((h, i) => ({ h, a: assets[i]! }))
      .filter(({ h }) => !p.bucket.holdings.some((x) => x.mint.equals(h.mint)))
      .map(({ h, a }) =>
        createAssociatedTokenAccountIdempotentInstruction(p.payer, this.pdas.vault(p.bucketAddress, h.mint, a.tokenProgram), p.bucketAddress, h.mint, a.tokenProgram),
      );
    const ix = await this.program.methods
      .proposeEdit(p.holdings.map((h) => h.weightBps), p.note)
      .accountsPartial({ creator: p.creator, config: this.pdas.config(), bucket: p.bucketAddress })
      .remainingAccounts(p.holdings.map((h) => ({ pubkey: this.pdas.asset(h.mint), isSigner: false, isWritable: false })))
      .instruction();
    return [...ataIxs, ix];
  }

  /** Forced removal of a delisted token; remaining = the kept holdings' assets (from the pending recipe if one exists). */
  adminProposeRemovalIx(admin: PublicKey, bucketAddress: PublicKey, bucket: BucketAccount, mint: PublicKey) {
    const base = bucket.pending.length > 0 ? bucket.pending.map((p) => p.mint) : bucket.holdings.filter((h) => h.weightBps > 0).map((h) => h.mint);
    const kept = base.filter((m) => !m.equals(mint));
    return this.program.methods
      .adminProposeRemoval(mint)
      .accountsPartial({ admin, config: this.pdas.config(), bucket: bucketAddress })
      .remainingAccounts(kept.map((m) => ({ pubkey: this.pdas.asset(m), isSigner: false, isWritable: false })))
      .instruction();
  }

  activateEditIx(bucketAddress: PublicKey, bucket: BucketAccount) {
    const newVaults = bucket.pending
      .filter((p) => !bucket.holdings.some((h) => h.mint.equals(p.mint)))
      .map((p) => ({ pubkey: p.vault, isSigner: false, isWritable: false }));
    return this.program.methods.activateEdit().accountsPartial({ bucket: bucketAddress }).remainingAccounts(newVaults).instruction();
  }

  async rebalanceIx(p: {
    keeper: PublicKey;
    bucketAddress: PublicKey;
    bucket: BucketAccount;
    config: ConfigAccount;
    fromMint: PublicKey;
    toMint: PublicKey;
    qtyIn: bigint;
    swap: SwapAdapter;
    slippageBps?: number;
  }): Promise<BuiltFlow & { expectedOut: bigint }> {
    const from = p.bucket.holdings.find((h) => h.mint.equals(p.fromMint));
    const to = p.bucket.holdings.find((h) => h.mint.equals(p.toMint));
    if (!from || !to) throw new Error('rebalance mints must both be holdings');
    const route = await p.swap.build({
      inputMint: p.fromMint,
      outputMint: p.toMint,
      amountIn: p.qtyIn,
      authority: p.bucketAddress,
      source: from.vault,
      destination: to.vault,
      slippageBps: p.slippageBps ?? p.config.params.maxSlippageBps,
    });
    const ix = await this.program.methods
      .rebalance(bn(p.qtyIn), bn(route.minOut), route.data)
      .accountsPartial({
        keeper: p.keeper,
        config: this.pdas.config(),
        bucket: p.bucketAddress,
        bucketMint: p.bucket.tokenMint,
        fromVault: from.vault,
        toVault: to.vault,
        fromAsset: this.pdas.asset(p.fromMint),
        toAsset: this.pdas.asset(p.toMint),
        swapProgram: route.programId,
      })
      .remainingAccounts(route.keys)
      .instruction();
    return { ixs: [ix], lookupTables: route.lookupTables, expectedOut: route.expectedOut };
  }

  // ------------------------------------------------------------ transactions

  /** v0 transaction with a compute budget; `lookupTables` resolved by the caller. */
  static v0(p: {
    payer: PublicKey;
    ixs: TransactionInstruction[];
    blockhash: string;
    lookupTables?: AddressLookupTableAccount[];
    computeUnits?: number;
    priorityMicroLamports?: number;
  }): VersionedTransaction {
    const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: p.computeUnits ?? 1_000_000 })];
    if (p.priorityMicroLamports) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.priorityMicroLamports }));
    const msg = new TransactionMessage({ payerKey: p.payer, recentBlockhash: p.blockhash, instructions: [...budget, ...p.ixs] }).compileToV0Message(
      p.lookupTables ?? [],
    );
    return new VersionedTransaction(msg);
  }

  async loadLookupTables(addresses: PublicKey[]): Promise<AddressLookupTableAccount[]> {
    const res = await Promise.all(addresses.map((a) => this.connection.getAddressLookupTable(a)));
    return res.map((r) => r.value).filter((v): v is AddressLookupTableAccount => v !== null);
  }
}

// ------------------------------------------------------------ events

export type BucketEventName =
  | 'ConfigUpdated'
  | 'AssetAdded'
  | 'AssetUpdated'
  | 'PriceUpdated'
  | 'BucketCreated'
  | 'BucketInfoUpdated'
  | 'MintOpened'
  | 'MintFilled'
  | 'MintClosed'
  | 'Redeemed'
  | 'RedeemFilled'
  | 'RedeemClaimed'
  | 'RedeemClosed'
  | 'CommissionSettled'
  | 'FeesClaimed'
  | 'BucketClosed'
  | 'EditProposed'
  | 'EditActivated'
  | 'Rebalanced';

/** JSON-safe event: pubkeys base58, u64/i64 as decimal strings, enums as their variant name. Field names as in Rust (snake_case). */
export interface BucketEvent {
  name: BucketEventName;
  data: Record<string, unknown>;
}

const jsonSafe = (v: unknown): unknown => {
  if (v instanceof PublicKey) return v.toBase58();
  if (BN.isBN(v)) return (v as BN).toString();
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    // Anchor enums decode as { variant: {} }
    if (entries.length === 1 && entries[0]![1] && typeof entries[0]![1] === 'object' && Object.keys(entries[0]![1] as object).length === 0) {
      return entries[0]![0];
    }
    return Object.fromEntries(entries.map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v;
};

/** Decodes every bucket_vault event in a transaction's log messages. */
export function decodeEvents(logs: string[], programId: PublicKey = BUCKET_VAULT_PROGRAM_ID): BucketEvent[] {
  const idl = { ...BUCKET_VAULT_IDL, address: programId.toBase58() };
  const parser = new EventParser(programId, new BorshCoder(idl as never));
  return [...parser.parseLogs(logs)].map((e) => ({ name: e.name as BucketEventName, data: jsonSafe(e.data) as Record<string, unknown> }));
}

export const statusOf = (b: BucketAccount) => enumKey(b.status) as 'open' | 'closed';
