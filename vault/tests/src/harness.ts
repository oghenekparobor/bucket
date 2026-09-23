// In-process test chain: LiteSVM running the compiled bucket_vault and
// mock_swap programs, driven through @bucket/sdk exactly as the backend does.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LiteSVM, FailedTransactionMetadata, TransactionMetadata, Clock } from 'litesvm';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';

import {
  BucketClient,
  BUCKET_VAULT_PROGRAM_ID,
  decodeEvents,
  defaultConfigParams,
  MOCK_SWAP_PROGRAM_ID,
  MockSwapAdapter,
  type BucketAccount,
  type BucketEvent,
  type AssetKind,
  type Source,
  type VaultParams,
} from '@bucket/sdk';

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(here, '..', '..', 'target', 'deploy');
const LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

export const USD = 1_000_000n;
export const usd = (n: number) => BigInt(Math.round(n * 1_000_000));

/** A minimal Connection backed by LiteSVM: enough for Anchor fetches and the SDK. */
class SvmConnection {
  constructor(private svm: LiteSVM) {}
  private info(pk: PublicKey) {
    const a = this.svm.getAccount(pk);
    if (!a) return null;
    return { data: Buffer.from(a.data), owner: new PublicKey(a.owner), lamports: Number(a.lamports), executable: a.executable, rentEpoch: 0 };
  }
  async getAccountInfo(pk: PublicKey) {
    return this.info(pk);
  }
  async getAccountInfoAndContext(pk: PublicKey) {
    return { context: { slot: 0 }, value: this.info(pk) };
  }
  async getMultipleAccountsInfo(pks: PublicKey[]) {
    return pks.map((p) => this.info(p));
  }
  async getMultipleAccountsInfoAndContext(pks: PublicKey[]) {
    return { context: { slot: 0 }, value: pks.map((p) => this.info(p)) };
  }
  async getEpochInfo() {
    const c = this.svm.getClock();
    return { epoch: Number(c.epoch), slotIndex: 0, slotsInEpoch: 432_000, absoluteSlot: Number(c.slot) };
  }
  async getTokenSupply(mint: PublicKey) {
    const a = this.info(mint)!;
    const amount = a.data.readBigUInt64LE(36);
    return { context: { slot: 0 }, value: { amount: amount.toString(), decimals: a.data[44]!, uiAmount: null } };
  }
}

export interface StockSpec {
  symbol: string;
  price: number;
  source: Source;
  kind: AssetKind;
  /** Issuer transfer fee in bps (PreStocks-style). */
  transferFeeBps?: number;
  /** mock_swap fee in bps. */
  swapFeeBps?: number;
}

export interface Stock extends StockSpec {
  mint: PublicKey;
  decimals: number;
  tokenProgram: PublicKey;
}

export class Chain {
  svm = new LiteSVM();
  connection: Connection;
  client: BucketClient;
  swap!: MockSwapAdapter;
  admin = Keypair.generate();
  keeper = Keypair.generate();
  priceAuthority = Keypair.generate();
  feeWallet = Keypair.generate();
  usdcMint!: PublicKey;
  stocks = new Map<string, Stock>();
  lookupTables = new Map<string, AddressLookupTableAccount>();
  /** Every event emitted, in order. */
  events: BucketEvent[] = [];
  lastLogs: string[] = [];
  lastCu = 0n;

  constructor() {
    this.connection = new SvmConnection(this.svm) as unknown as Connection;
    this.client = new BucketClient(this.connection);
  }

  static async boot(stocks: StockSpec[], paramOverrides: Partial<VaultParams> = {}): Promise<Chain> {
    const c = new Chain();
    c.loadPrograms();
    for (const k of [c.admin, c.keeper, c.priceAuthority, c.feeWallet]) c.fund(k.publicKey);
    c.setUnixTime(1_790_000_000n);

    // mock USDC: classic SPL, 6 dp, mint authority = mock_swap's PDA (so the faucet and swaps can mint it)
    const authority = new MockSwapAdapter(c.connection, PublicKey.default).pdas.mintAuthority();
    c.usdcMint = c.createMint(6, authority, TOKEN_PROGRAM_ID);
    c.swap = new MockSwapAdapter(c.connection, c.usdcMint);
    await c.send(
      [
        await c.swap.program.methods
          .initState(c.priceAuthority.publicKey)
          .accountsPartial({
            admin: c.admin.publicKey,
            state: c.swap.pdas.state(),
            mintAuthority: authority,
            usdcMint: c.usdcMint,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      [c.admin],
    );

    await c.send(
      [
        await c.client.initializeConfigIx({
          authority: c.admin.publicKey,
          usdcMint: c.usdcMint,
          params: defaultConfigParams(paramOverrides),
          roles: {
            admin: c.admin.publicKey,
            keeper: c.keeper.publicKey,
            priceAuthority: c.priceAuthority.publicKey,
            feeWallet: c.feeWallet.publicKey,
            swapPrograms: [MOCK_SWAP_PROGRAM_ID, PublicKey.default, PublicKey.default, PublicKey.default],
          },
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          c.admin.publicKey,
          getAssociatedTokenAddressSync(c.usdcMint, c.feeWallet.publicKey),
          c.feeWallet.publicKey,
          c.usdcMint,
        ),
      ],
      [c.admin],
    );
    for (const s of stocks) await c.addStock(s);
    return c;
  }

  private loadPrograms() {
    // bucket_vault goes in as an upgradeable program so initialize_config's
    // upgrade-authority check runs for real.
    const elf = readFileSync(join(DEPLOY, 'bucket_vault.so'));
    const programData = PublicKey.findProgramAddressSync([BUCKET_VAULT_PROGRAM_ID.toBuffer()], LOADER_UPGRADEABLE)[0];
    const pd = Buffer.alloc(45 + elf.length);
    pd.writeUInt32LE(3, 0);
    pd.writeBigUInt64LE(0n, 4);
    pd[12] = 1;
    this.admin.publicKey.toBuffer().copy(pd, 13);
    elf.copy(pd, 45);
    this.svm.setAccount(programData, { executable: false, owner: LOADER_UPGRADEABLE, lamports: 1_000_000_000_000, data: pd });
    const prog = Buffer.alloc(36);
    prog.writeUInt32LE(2, 0);
    programData.toBuffer().copy(prog, 4);
    this.svm.setAccount(BUCKET_VAULT_PROGRAM_ID, { executable: true, owner: LOADER_UPGRADEABLE, lamports: 1_000_000_000, data: prog });
    this.svm.addProgram(MOCK_SWAP_PROGRAM_ID, readFileSync(join(DEPLOY, 'mock_swap.so')));
  }

  fund(pk: PublicKey, sol = 1_000) {
    this.svm.airdrop(pk, BigInt(sol * LAMPORTS_PER_SOL));
  }

  user(sol = 100): Keypair {
    const k = Keypair.generate();
    this.fund(k.publicKey, sol);
    return k;
  }

  // ------------------------------------------------------------ clock

  now = () => this.svm.getClock().unixTimestamp;
  setUnixTime(t: bigint) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, t));
  }
  advance(secs: number) {
    this.setUnixTime(this.now() + BigInt(secs));
    this.svm.expireBlockhash();
  }
  nextSlot() {
    const c = this.svm.getClock();
    this.svm.warpToSlot(c.slot + 1n);
    this.svm.expireBlockhash();
  }

  // ------------------------------------------------------------ tokens

  createMint(decimals: number, authority: PublicKey, tokenProgram: PublicKey, transferFeeBps = 0): PublicKey {
    const mint = Keypair.generate();
    const ixs: TransactionInstruction[] = [];
    const len = transferFeeBps > 0 ? getMintLen([ExtensionType.TransferFeeConfig]) : MINT_SIZE;
    ixs.push(
      SystemProgram.createAccount({
        fromPubkey: this.admin.publicKey,
        newAccountPubkey: mint.publicKey,
        space: len,
        lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(len))),
        programId: tokenProgram,
      }),
    );
    if (transferFeeBps > 0) {
      ixs.push(
        createInitializeTransferFeeConfigInstruction(mint.publicKey, this.admin.publicKey, this.admin.publicKey, transferFeeBps, BigInt('18446744073709551615'), tokenProgram),
      );
    }
    ixs.push(createInitializeMint2Instruction(mint.publicKey, decimals, authority, null, tokenProgram));
    this.sendSync(ixs, [this.admin, mint]);
    return mint.publicKey;
  }

  async addStock(s: StockSpec): Promise<Stock> {
    const authority = this.swap.pdas.mintAuthority();
    const mint = this.createMint(8, authority, TOKEN_2022_PROGRAM_ID, s.transferFeeBps ?? 0);
    const stock: Stock = { ...s, mint, decimals: 8, tokenProgram: TOKEN_2022_PROGRAM_ID };
    const priceE6 = usd(s.price);
    await this.send(
      [
        await this.swap.program.methods
          .createMarket(new BN(priceE6.toString()), s.swapFeeBps ?? 10)
          .accountsPartial({
            admin: this.admin.publicKey,
            state: this.swap.pdas.state(),
            mintAuthority: authority,
            stockMint: mint,
            market: this.swap.pdas.market(mint),
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
        createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, this.swap.pdas.inventory(mint, TOKEN_2022_PROGRAM_ID), authority, mint, TOKEN_2022_PROGRAM_ID),
        await this.client.addAssetIx({
          admin: this.admin.publicKey,
          mint,
          source: s.source,
          kind: s.kind,
          symbol: s.symbol,
          extraCostBps: s.transferFeeBps ?? 0,
          priceE6,
        }),
      ],
      [this.admin],
    );
    this.stocks.set(s.symbol, stock);
    return stock;
  }

  stock(symbol: string): Stock {
    const s = this.stocks.get(symbol);
    if (!s) throw new Error(`no stock ${symbol}`);
    return s;
  }

  /** Moves both the on-chain Asset price and the mock market price. */
  async setPrice(symbol: string, price: number, opts: { force?: boolean; marketOnly?: boolean; assetOnly?: boolean } = {}) {
    const s = this.stock(symbol);
    const p = usd(price);
    const ixs: TransactionInstruction[] = [];
    if (!opts.assetOnly) {
      ixs.push(
        await this.swap.program.methods
          .setPrice(new BN(p.toString()))
          .accountsPartial({ signer: this.priceAuthority.publicKey, state: this.swap.pdas.state(), market: this.swap.pdas.market(s.mint) })
          .instruction(),
      );
    }
    if (!opts.marketOnly) {
      ixs.push(await this.client.updatePriceIx(opts.force ? this.admin.publicKey : this.priceAuthority.publicKey, s.mint, p, opts.force));
    }
    await this.send(ixs, opts.force ? [this.priceAuthority, this.admin] : [this.priceAuthority]);
  }

  async faucet(to: PublicKey, amount: bigint) {
    const ata = getAssociatedTokenAddressSync(this.usdcMint, to, true);
    const ixs: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, ata, to, this.usdcMint)];
    for (let left = amount; left > 0n; left -= 10_000n * USD) {
      const chunk = left > 10_000n * USD ? 10_000n * USD : left;
      ixs.push(
        await this.swap.program.methods
          .faucet(new BN(chunk.toString()))
          .accountsPartial({
            state: this.swap.pdas.state(),
            mintAuthority: this.swap.pdas.mintAuthority(),
            usdcMint: this.usdcMint,
            destination: ata,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      );
    }
    for (let i = 0; i < ixs.length; i += 10) await this.send(ixs.slice(i, i + 10), [this.admin]);
    return ata;
  }

  tokenBalance(account: PublicKey): bigint {
    const a = this.svm.getAccount(account);
    if (!a) return 0n;
    return Buffer.from(a.data).readBigUInt64LE(64);
  }
  usdcOf = (owner: PublicKey) => this.tokenBalance(getAssociatedTokenAddressSync(this.usdcMint, owner, true));
  supplyOf(mint: PublicKey): bigint {
    return Buffer.from(this.svm.getAccount(mint)!.data).readBigUInt64LE(36);
  }

  // ------------------------------------------------------------ lookup tables

  /** Writes an address lookup table straight into the SVM (no warm-up slot needed). */
  setLookupTable(addresses: PublicKey[]): AddressLookupTableAccount {
    const key = Keypair.generate().publicKey;
    const data = Buffer.alloc(56 + addresses.length * 32);
    data.writeUInt32LE(1, 0);
    data.writeBigUInt64LE(BigInt('18446744073709551615'), 4);
    data.writeBigUInt64LE(0n, 12);
    data[20] = 0;
    data[21] = 1;
    this.admin.publicKey.toBuffer().copy(data, 22);
    addresses.forEach((a, i) => a.toBuffer().copy(data, 56 + i * 32));
    this.svm.setAccount(key, {
      executable: false,
      owner: new PublicKey('AddressLookupTab1e1111111111111111111111111'),
      lamports: 1_000_000_000,
      data,
    });
    const table = new AddressLookupTableAccount({
      key,
      state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: this.admin.publicKey, addresses },
    });
    this.lookupTables.set(key.toBase58(), table);
    return table;
  }

  async bucketTable(bucketAddress: PublicKey, bucket: BucketAccount): Promise<AddressLookupTableAccount> {
    const config = await this.client.config();
    return this.setLookupTable(this.client.lookupTableAddresses(bucketAddress, bucket, config));
  }

  // ------------------------------------------------------------ send

  sendSync(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []): TransactionMetadata {
    const res = this.trySendSync(ixs, signers, tables);
    if (res instanceof FailedTransactionMetadata) {
      throw new TxError(res);
    }
    return res;
  }

  trySendSync(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []) {
    const payer = signers[0]!;
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: this.svm.latestBlockhash(),
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs],
    }).compileToV0Message(tables);
    const tx = new VersionedTransaction(msg);
    tx.sign(signers);
    const res = this.svm.sendTransaction(tx);
    const meta = res instanceof FailedTransactionMetadata ? res.meta() : res;
    this.lastLogs = meta.logs();
    this.lastCu = meta.computeUnitsConsumed();
    if (!(res instanceof FailedTransactionMetadata)) {
      this.events.push(...decodeEvents(this.lastLogs));
    }
    this.svm.expireBlockhash();
    return res;
  }

  async send(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []) {
    return this.sendSync(ixs, signers, tables);
  }

  /** Sends and returns the program error name, or throws if the tx succeeded. */
  async expectError(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []): Promise<string> {
    const res = this.trySendSync(ixs, signers, tables);
    if (!(res instanceof FailedTransactionMetadata)) throw new Error('expected the transaction to fail');
    return errorName(this.lastLogs);
  }

  eventsNamed(name: BucketEvent['name']) {
    return this.events.filter((e) => e.name === name);
  }
}

export function errorName(logs: string[]): string {
  for (const l of logs) {
    const m = /Error Code: (\w+)/.exec(l);
    if (m) return m[1]!;
  }
  const custom = logs.find((l) => l.includes('failed:'));
  return custom ?? logs.slice(-3).join(' | ');
}

export class TxError extends Error {
  constructor(readonly meta: FailedTransactionMetadata) {
    const logs = meta.meta().logs();
    super(`transaction failed: ${errorName(logs)}\n${logs.slice(-12).join('\n')}`);
  }
}

export const DESIGN_STOCKS: StockSpec[] = [
  { symbol: 'NVDAx', price: 184.2, source: 'xStocks', kind: 'publicStock' },
  { symbol: 'MSFTx', price: 519.8, source: 'xStocks', kind: 'publicStock' },
  { symbol: 'AAPLx', price: 258.4, source: 'xStocks', kind: 'publicStock' },
  { symbol: 'SPYx', price: 664.2, source: 'xStocks', kind: 'etf' },
  { symbol: 'pSPACEX', price: 119.05, source: 'preStocks', kind: 'preIpo', transferFeeBps: 100 },
  { symbol: 'tSTRIPE', price: 44.8, source: 'tessera', kind: 'preIpo', transferFeeBps: 20 },
];
