/**
 * ChainGateway on @bucket/sdk (patterns from vault/scripts/e2e.ts). User-facing transactions are built
 * with the Bucket fee payer as fee payer and partially signed; keeper and price-authority transactions
 * are signed and sent here. Every bucket transaction uses the bucket's lookup table when one is known.
 */
import { BorshCoder } from '@coral-xyz/anchor';
import {
  type BucketAccount,
  BucketClient,
  type ConfigAccount,
  JupiterAdapter,
  math,
  MockSwapAdapter,
  type SwapAdapter,
} from '@bucket/sdk';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  type TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { accountRentFeeE6 } from '../perf/math.js';
import { chunk } from '../util/concurrency.js';
import { sleep } from '../util/time.js';
import {
  type BuiltCreate,
  type ChainGateway,
  ChainUnavailableError,
  type HoldingInput,
  type OpenOrder,
  type ProgramAsset,
  type RebalanceTrade,
} from './gateway.js';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ATAS_PER_TX = 5;
const PRICES_PER_TX = 4;
const CONFIG_TTL_MS = 30_000;
const CONFIRM_TIMEOUT_MS = 60_000;
const REBROADCAST_MS = 2_000;
const ALT_RETRIES = 8;
/** Solana's hard packet limit for a serialized transaction. */
const MAX_TX_BYTES = 1232;
const U64_MAX = BigInt('18446744073709551615');

/** A transaction the user asked us to relay was malformed or not allowed. */
export class TxRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TxRejectedError';
  }
}

/** A transaction landed and failed, or never confirmed. */
export class TxFailedError extends Error {
  constructor(
    message: string,
    readonly signature: string | null,
    readonly logs: string[] = [],
  ) {
    super(message);
    this.name = 'TxFailedError';
  }
}

export interface SdkGatewayOptions {
  connection: Connection;
  programId: PublicKey;
  usdcMint: PublicKey;
  mainnet: boolean;
  mockSwapProgramId: PublicKey | null;
  keys: { feePayer: Keypair | null; keeper: Keypair | null; priceAuthority: Keypair | null };
  /** The lookup table recorded for a bucket when we built its publish transactions. */
  lookupTableOf: (bucket: string) => Promise<string | null>;
  /** Latest SOL/USD price, used to charge a new backer the account rent the fee payer fronts. */
  solPriceUsd: () => Promise<number | null>;
}

export class SdkChainGateway implements ChainGateway {
  readonly client: BucketClient;
  private readonly connection: Connection;
  private readonly mock: MockSwapAdapter | null;
  private readonly allowedPrograms: Set<string>;
  private configCache: { at: number; value: ConfigAccount } | null = null;
  private readonly coder: BorshCoder;

  constructor(private readonly o: SdkGatewayOptions) {
    this.connection = o.connection;
    this.client = new BucketClient(o.connection, { programId: o.programId });
    this.coder = new BorshCoder(this.client.program.idl);
    this.mock = o.mainnet ? null : new MockSwapAdapter(o.connection, o.usdcMint, o.mockSwapProgramId ?? undefined);
    this.allowedPrograms = new Set([
      o.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
      SystemProgram.programId.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      MEMO_PROGRAM,
      AddressLookupTableProgram.programId.toBase58(),
    ]);
  }

  // ── plumbing ──

  private key(role: keyof SdkGatewayOptions['keys']): Keypair {
    const k = this.o.keys[role];
    if (!k) {
      const name = role === 'feePayer' ? 'FEE_PAYER' : role === 'keeper' ? 'KEEPER' : 'PRICE_AUTHORITY';
      // Names the secret form first: a deployment has no keys/ directory to point a path at.
      throw new ChainUnavailableError(`No ${role} keypair configured (set ${name}_KEYPAIR, or ${name}_KEYPAIR_PATH for a local keypair file)`);
    }
    return k;
  }

  private async config(): Promise<ConfigAccount> {
    if (this.configCache && Date.now() - this.configCache.at < CONFIG_TTL_MS) return this.configCache.value;
    const value = await this.client.config();
    this.configCache = { at: Date.now(), value };
    return value;
  }

  private swap(): SwapAdapter {
    return this.mock ?? new JupiterAdapter();
  }

  private async tables(bucket: string, extra: PublicKey[] = []): Promise<AddressLookupTableAccount[]> {
    const table = await this.o.lookupTableOf(bucket);
    const keys = [...(table ? [new PublicKey(table)] : []), ...extra];
    return keys.length ? this.client.loadLookupTables(keys) : [];
  }

  private async bucket(address: string): Promise<{ pk: PublicKey; acct: BucketAccount }> {
    const pk = new PublicKey(address);
    return { pk, acct: await this.client.bucket(pk) };
  }

  /** Rent fee for the backer's bucket-token account: charged only when it does not exist yet. */
  private async rentFee(tokenMint: PublicKey, backer: PublicKey, known?: 'new'): Promise<bigint> {
    const isNew = known === 'new' || !(await this.connection.getAccountInfo(getAssociatedTokenAddressSync(tokenMint, backer, true, TOKEN_PROGRAM_ID)));
    return isNew ? accountRentFeeE6(await this.o.solPriceUsd()) : 0n;
  }

  /** A fee-payer-signed v0 transaction for the user to co-sign, as base64. */
  private encode(ixs: TransactionInstruction[], blockhash: string, tables: AddressLookupTableAccount[] = []): string {
    const feePayer = this.key('feePayer');
    const tx = this.compile(feePayer.publicKey, ixs, blockhash, tables);
    tx.sign([feePayer]);
    const raw = tx.serialize();
    // Catch an oversized transaction here rather than letting the user's submit fail in simulation.
    if (raw.length > MAX_TX_BYTES) {
      throw new TxRejectedError(
        `Transaction is ${raw.length} bytes, over Solana's ${MAX_TX_BYTES}-byte limit (${ixs.length} instruction(s)). Split it into more transactions.`,
      );
    }
    return Buffer.from(raw).toString('base64');
  }

  /**
   * v0 transaction that uses lookup tables only when it would not fit otherwise. A freshly created table
   * is accepted by the leader only ~a root (~13s) after its creation even though simulation passes
   * sooner, so small transactions should not depend on one.
   */
  private compile(payer: PublicKey, ixs: TransactionInstruction[], blockhash: string, tables: AddressLookupTableAccount[]): VersionedTransaction {
    if (tables.length) {
      try {
        const plain = BucketClient.v0({ payer, ixs, blockhash });
        if (plain.serialize().length <= MAX_TX_BYTES) return plain;
      } catch {
        // too large to serialize without tables
      }
    }
    return BucketClient.v0({ payer, ixs, blockhash, lookupTables: tables });
  }

  /**
   * Sends with preflight, then rebroadcasts every 2s until confirmed, failed or timed out (RPC retries
   * alone give up before a new lookup table becomes usable). Preflight failures from a table extended in
   * the previous slot are retried briefly; others surface with the simulation error and program logs.
   */
  private async sendAndConfirm(bytes: Uint8Array): Promise<string> {
    let sig: string | null = null;
    for (let attempt = 0; sig === null; attempt++) {
      try {
        sig = await this.connection.sendRawTransaction(bytes, { maxRetries: 0 });
      } catch (err) {
        const detail = err instanceof SendTransactionError ? err.transactionError.message : (err as Error).message;
        if (attempt < ALT_RETRIES && /lookup ?table|invalid.*index/i.test(detail)) {
          await sleep(500);
          continue;
        }
        const logs = err instanceof SendTransactionError ? ((await err.getLogs(this.connection).catch(() => [])) ?? []) : [];
        throw new TxFailedError(`simulation failed: ${detail}${logs.length ? ` | ${logs.slice(-3).join(' | ')}` : ''}`, null, logs);
      }
    }
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    let lastSent = Date.now();
    while (Date.now() < deadline) {
      const status = (await this.connection.getSignatureStatuses([sig])).value[0];
      if (status?.err) throw new TxFailedError(`${sig} failed: ${JSON.stringify(status.err)}`, sig);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return sig;
      if (Date.now() - lastSent >= REBROADCAST_MS) {
        await this.connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
        lastSent = Date.now();
      }
      await sleep(400);
    }
    throw new TxFailedError(`${sig} was not confirmed within ${CONFIRM_TIMEOUT_MS / 1000}s`, sig);
  }

  /** Signs with `signers` (first pays), sends and waits for confirmation. */
  private async send(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const tx = this.compile(signers[0]!.publicKey, ixs, blockhash, tables);
    tx.sign(signers);
    return this.sendAndConfirm(tx.serialize());
  }

  // ── user transactions ──

  async buildCreateBucketTxs(p: { creator: string; name: string; thesis: string; holdings: HoldingInput[]; stakeE6: bigint }): Promise<BuiltCreate> {
    const feePayer = this.key('feePayer');
    const creator = new PublicKey(p.creator);
    const holdings = p.holdings.map((h) => ({ mint: new PublicKey(h.mint), weightBps: h.weightBps }));
    const [config, flow, assets, slot, { blockhash }] = await Promise.all([
      this.config(),
      this.client.createBucketFlow({ creator, payer: feePayer.publicKey, name: p.name, thesis: p.thesis, holdings }),
      this.client.assets(holdings.map((h) => h.mint)),
      this.connection.getSlot('finalized'),
      this.connection.getLatestBlockhash('confirmed'),
    ]);
    // The bucket account does not exist yet; its lookup table and first mint only need these fields.
    const planned = {
      tokenMint: flow.bucketMint,
      holdings: holdings.map((h, i) => ({ mint: h.mint, vault: this.client.pdas.vault(flow.bucket, h.mint, assets[i]!.tokenProgram) })),
    } as unknown as BucketAccount;
    const addresses = this.client.lookupTableAddresses(flow.bucket, planned, config);
    const lt = this.client.lookupTableIxs(feePayer.publicKey, feePayer.publicKey, slot, addresses);
    const table = new AddressLookupTableAccount({
      key: lt.table,
      state: { addresses, authority: feePayer.publicKey, deactivationSlot: U64_MAX, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0 },
    });
    const { ix: mintIx, order } = await this.client.openMintIx({
      backer: creator,
      payer: feePayer.publicKey,
      bucketAddress: flow.bucket,
      bucket: planned,
      config,
      amountE6: p.stakeE6,
      rentFeeE6: await this.rentFee(flow.bucketMint, creator, 'new'),
    });
    // Order: vault ATAs, lookup table (create, then one extend per transaction — an extend carries up
    // to 24 × 32 bytes of addresses, so it does not share a transaction with anything), create_bucket
    // and the first mint through the table. These are all fee-payer-signed, so the extra transactions
    // cost the user nothing but a moment.
    const transactions = [
      ...chunk(flow.ataIxs, ATAS_PER_TX).map((ixs) => this.encode(ixs, blockhash)),
      this.encode([lt.create], blockhash),
      ...lt.extends.map((ix) => this.encode([ix], blockhash)),
      this.encode([flow.createIx], blockhash, [table]),
      this.encode([mintIx], blockhash, [table]),
    ];
    return { transactions, bucket: flow.bucket.toBase58(), lookupTable: lt.table.toBase58(), order: order.toBase58() };
  }

  async buildMintTx(p: { backer: string; bucket: string; amountE6: bigint }) {
    const feePayer = this.key('feePayer');
    const [{ pk, acct }, config, { blockhash }] = await Promise.all([this.bucket(p.bucket), this.config(), this.connection.getLatestBlockhash('confirmed')]);
    const backer = new PublicKey(p.backer);
    const { ix, order } = await this.client.openMintIx({
      backer,
      payer: feePayer.publicKey,
      bucketAddress: pk,
      bucket: acct,
      config,
      amountE6: p.amountE6,
      rentFeeE6: await this.rentFee(acct.tokenMint, backer),
    });
    return { transaction: this.encode([ix], blockhash, await this.tables(p.bucket)), order: order.toBase58() };
  }

  async buildRedeemTx(p: { holder: string; bucket: string; tokens: bigint }) {
    const feePayer = this.key('feePayer');
    const [{ pk, acct }, { blockhash }] = await Promise.all([this.bucket(p.bucket), this.connection.getLatestBlockhash('confirmed')]);
    const { ix, order } = await this.client.redeemIx({ holder: new PublicKey(p.holder), payer: feePayer.publicKey, bucketAddress: pk, bucket: acct, tokens: p.tokens });
    return { transaction: this.encode([ix], blockhash, await this.tables(p.bucket)), order: order.toBase58() };
  }

  async buildCloseBucketTx(p: { creator: string; bucket: string }) {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    return { transaction: this.encode([await this.client.closeBucketIx(new PublicKey(p.creator), new PublicKey(p.bucket))], blockhash) };
  }

  async buildUpdateInfoTx(p: { creator: string; bucket: string; name: string; thesis: string }) {
    const [{ blockhash }, ix] = await Promise.all([
      this.connection.getLatestBlockhash('confirmed'),
      this.client.updateBucketInfoIx(new PublicKey(p.creator), new PublicKey(p.bucket), p.name, p.thesis),
    ]);
    return { transaction: this.encode([ix], blockhash) };
  }

  async buildProposeEditTx(p: { creator: string; bucket: string; holdings: HoldingInput[]; note: string | null }) {
    const [{ pk, acct }, { blockhash }] = await Promise.all([this.bucket(p.bucket), this.connection.getLatestBlockhash('confirmed')]);
    const creator = new PublicKey(p.creator);
    // The creator pays rent for any new vault account the edit adds (checklist 2.1).
    const ixs = await this.client.proposeEditIxs({
      creator,
      payer: creator,
      bucketAddress: pk,
      bucket: acct,
      holdings: p.holdings.map((h) => ({ mint: new PublicKey(h.mint), weightBps: h.weightBps })),
      note: p.note ?? '',
    });
    return { transaction: this.encode(ixs, blockhash, await this.tables(p.bucket)) };
  }

  inspectTransaction(transactionBase64: string): { sponsored: boolean; instructions: string[] } {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
    } catch {
      throw new TxRejectedError('transaction is not a base64-encoded versioned transaction');
    }
    const keys = tx.message.staticAccountKeys;
    const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const instructions = tx.message.compiledInstructions
      .filter((ix) => keys[ix.programIdIndex]?.equals(this.o.programId))
      .map((ix) => snake(this.coder.instruction.decode(Buffer.from(ix.data))?.name ?? 'unknown'));
    const feePayer = this.o.keys.feePayer?.publicKey;
    return { sponsored: !!feePayer && keys[0]!.equals(feePayer), instructions };
  }

  /**
   * Relays a signed transaction and waits for confirmation. It must call only Bucket-allowed programs,
   * carry every required signature, and be signed by the signed-in wallet unless the Bucket fee payer is
   * its only signer (publish steps such as vault ATAs and the lookup table), so this is not an open relay.
   */
  async submit(transactionBase64: string, signer: string): Promise<string> {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
    } catch {
      throw new TxRejectedError('transaction is not a base64-encoded versioned transaction');
    }
    const msg = tx.message;
    const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k) => k.toBase58());
    const feePayer = this.o.keys.feePayer?.publicKey.toBase58();
    const feePayerOnly = signers.length === 1 && signers[0] === feePayer;
    if (!feePayerOnly && !signers.includes(signer)) throw new TxRejectedError('the signed-in wallet is not a signer of this transaction');
    if (tx.signatures.some((s) => s.every((b) => b === 0))) throw new TxRejectedError('transaction is missing a signature');
    for (const ix of msg.compiledInstructions) {
      const program = msg.staticAccountKeys[ix.programIdIndex]?.toBase58();
      if (!program || !this.allowedPrograms.has(program)) throw new TxRejectedError(`program ${program} is not allowed`);
    }
    return this.sendAndConfirm(tx.serialize());
  }

  // ── keeper ──

  async listProgramAssets(): Promise<ProgramAsset[]> {
    const enumKey = (e: object) => Object.keys(e)[0] ?? '';
    return (await this.client.allAssets()).map(({ account: a }) => ({
      mint: a.mint.toBase58(),
      symbol: a.symbol,
      source: enumKey(a.source),
      assetType: enumKey(a.assetType),
      decimals: a.decimals,
      tokenProgram: a.tokenProgram.toBase58(),
      enabled: a.enabled,
      flagged: a.flagged,
      extraCostBps: a.extraCostBps,
      priceE6: BigInt(a.priceE6.toString()),
      lastPriceTs: Number(a.lastPriceTs.toString()),
    }));
  }

  async fetchOpenOrders(): Promise<OpenOrder[]> {
    const [mints, redeems] = await Promise.all([this.client.openMintOrders(), this.client.openRedeemOrders()]);
    const now = Math.floor(Date.now() / 1000);
    return [
      ...mints.map((m) => ({
        kind: 'mint' as const,
        address: m.publicKey.toBase58(),
        bucket: m.account.bucket.toBase58(),
        owner: m.account.backer.toBase58(),
        legs: m.account.legs.map((l, leg) => ({ leg, done: l.done })),
        expired: Number(m.account.expiresAt.toString()) < now,
      })),
      ...redeems.map((r) => ({
        kind: 'redeem' as const,
        address: r.publicKey.toBase58(),
        bucket: r.account.bucket.toBase58(),
        owner: r.account.holder.toBase58(),
        legs: r.account.legs.map((l, leg) => ({ leg, done: l.done })),
        expired: false,
      })),
    ];
  }

  async fillMintLeg(order: string, leg: number): Promise<string> {
    const keeper = this.key('keeper');
    const orderPk = new PublicKey(order);
    const o = await this.client.mintOrder(orderPk);
    const [acct, config] = await Promise.all([this.client.bucket(o.bucket), this.config()]);
    const f = await this.client.fillMintIx({ signer: keeper.publicKey, bucketAddress: o.bucket, bucket: acct, config, orderAddress: orderPk, order: o, leg, swap: this.swap() });
    return this.send(f.ixs, [keeper], await this.tables(o.bucket.toBase58(), f.lookupTables));
  }

  async closeMintOrder(order: string): Promise<string> {
    const keeper = this.key('keeper');
    const orderPk = new PublicKey(order);
    const [o, config] = await Promise.all([this.client.mintOrder(orderPk), this.config()]);
    return this.send([await this.client.closeMintOrderIx({ signer: keeper.publicKey, config, orderAddress: orderPk, order: o })], [keeper]);
  }

  async fillRedeemLeg(order: string, leg: number): Promise<string> {
    const keeper = this.key('keeper');
    const orderPk = new PublicKey(order);
    const o = await this.client.redeemOrder(orderPk);
    const [acct, config] = await Promise.all([this.client.bucket(o.bucket), this.config()]);
    const f = await this.client.fillRedeemIx({ signer: keeper.publicKey, bucketAddress: o.bucket, bucket: acct, config, orderAddress: orderPk, order: o, leg, swap: this.swap() });
    return this.send(f.ixs, [keeper], await this.tables(o.bucket.toBase58(), f.lookupTables));
  }

  async closeRedeemOrder(order: string): Promise<string> {
    const keeper = this.key('keeper');
    const orderPk = new PublicKey(order);
    const o = await this.client.redeemOrder(orderPk);
    return this.send([await this.client.closeRedeemOrderIx(orderPk, o)], [keeper]);
  }

  async settle(bucket: string): Promise<string> {
    const keeper = this.key('keeper');
    const { pk, acct } = await this.bucket(bucket);
    return this.send([await this.client.settleIx(pk, acct)], [keeper], await this.tables(bucket));
  }

  async activateEdit(bucket: string): Promise<string> {
    const keeper = this.key('keeper');
    const { pk, acct } = await this.bucket(bucket);
    return this.send([await this.client.activateEditIx(pk, acct)], [keeper], await this.tables(bucket));
  }

  async rebalance(t: RebalanceTrade): Promise<string> {
    const keeper = this.key('keeper');
    const [{ pk, acct }, config] = await Promise.all([this.bucket(t.bucket), this.config()]);
    const r = await this.client.rebalanceIx({
      keeper: keeper.publicKey,
      bucketAddress: pk,
      bucket: acct,
      config,
      fromMint: new PublicKey(t.fromMint),
      toMint: new PublicKey(t.toMint),
      qtyIn: t.qtyIn,
      swap: this.swap(),
    });
    return this.send([await this.client.settleIx(pk, acct), ...r.ixs], [keeper], await this.tables(t.bucket, r.lookupTables));
  }

  // ── price authority / faucet ──

  /**
   * The program clamps each update_price to ±max_price_move_bps of the Asset's TWAP, so the mock_swap
   * market is set to the price the program will accept (math.clampPrice), never the raw target:
   * otherwise venue and Asset drift apart and every fill fails its slippage check.
   */
  async pushPrices(updates: { mint: string; priceE6: bigint }[]): Promise<string[]> {
    const authority = this.key('priceAuthority');
    const config = await this.config();
    const sigs: string[] = [];
    for (const batch of chunk(updates, PRICES_PER_TX)) {
      const mints = batch.map((u) => new PublicKey(u.mint));
      const assets = await this.client.assets(mints);
      const ixs: TransactionInstruction[] = [];
      for (const [i, u] of batch.entries()) {
        const [accepted] = math.clampPrice(u.priceE6, BigInt(assets[i]!.twapE6.toString()), config.params.maxPriceMoveBps);
        ixs.push(await this.client.updatePriceIx(authority.publicKey, mints[i]!, accepted));
        if (this.mock) {
          ixs.push(
            await this.mock.program.methods
              .setPrice(new BN(accepted.toString()))
              .accountsPartial({ signer: authority.publicKey, state: this.mock.pdas.state(), market: this.mock.pdas.market(mints[i]!) })
              .instruction(),
          );
        }
      }
      sigs.push(await this.send(ixs, [authority]));
    }
    return sigs;
  }

  async faucet(wallet: string, amountE6: bigint): Promise<string> {
    if (!this.mock) throw new ChainUnavailableError('The faucet only exists off mainnet');
    const feePayer = this.key('feePayer');
    const owner = new PublicKey(wallet);
    const ata = getAssociatedTokenAddressSync(this.o.usdcMint, owner, true, TOKEN_PROGRAM_ID);
    const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, ata, owner, this.o.usdcMint, TOKEN_PROGRAM_ID)];
    const MAX_PER_IX = 10_000_000_000n; // mock_swap caps each faucet call at $10k
    for (let left = amountE6; left > 0n; left -= MAX_PER_IX) {
      const amount = left > MAX_PER_IX ? MAX_PER_IX : left;
      ixs.push(
        await this.mock.program.methods
          .faucet(new BN(amount.toString()))
          .accountsPartial({ state: this.mock.pdas.state(), mintAuthority: this.mock.pdas.mintAuthority(), usdcMint: this.o.usdcMint, destination: ata, tokenProgram: TOKEN_PROGRAM_ID })
          .instruction(),
      );
    }
    return this.send(ixs, [feePayer]);
  }

  async getWalletBalances(wallet: string): Promise<{ solLamports: bigint; usdcE6: bigint }> {
    const owner = new PublicKey(wallet);
    const [lamports, accounts] = await Promise.all([
      this.connection.getBalance(owner),
      this.connection.getParsedTokenAccountsByOwner(owner, { mint: this.o.usdcMint }),
    ]);
    const usdcE6 = accounts.value.reduce(
      (sum, a) => sum + BigInt((a.account.data as { parsed: { info: { tokenAmount: { amount: string } } } }).parsed.info.tokenAmount.amount),
      0n,
    );
    return { solLamports: BigInt(lamports), usdcE6 };
  }
}

