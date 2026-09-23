// Swap venues for fill_mint / fill_redeem / rebalance. The vault program CPIs
// whatever allow-listed program these return, passing the accounts through
// and signing as the order or bucket PDA, then checks balances itself.

import { AnchorProvider, Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { AccountMeta, Connection, PublicKey } from '@solana/web3.js';
import {
  calculateEpochFee,
  getTransferFeeConfig,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';

import { MOCK_SWAP_PROGRAM_ID, JUPITER_V6_PROGRAM_ID } from './constants.js';
import { MOCK_SWAP_IDL, type MockSwap } from './idl/mock_swap.js';
import { MockSwapPdas } from './pda.js';

export interface SwapRequest {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amountIn: bigint;
  /** PDA that owns `source` and signs through the vault program's CPI. */
  authority: PublicKey;
  source: PublicKey;
  destination: PublicKey;
  slippageBps: number;
}

export interface SwapInstruction {
  programId: PublicKey;
  /** Passed as the vault instruction's remaining accounts. The PDA authority is not marked signer here. */
  keys: AccountMeta[];
  data: Buffer;
  expectedOut: bigint;
  minOut: bigint;
  lookupTables: PublicKey[];
}

export interface SwapAdapter {
  readonly programId: PublicKey;
  build(req: SwapRequest): Promise<SwapInstruction>;
}

/** Anchor provider that can build instructions and fetch accounts but never signs. */
export const readonlyProvider = (connection: Connection) =>
  new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async <T>(t: T) => t,
      signAllTransactions: async <T>(t: T[]) => t,
    } as unknown as ConstructorParameters<typeof AnchorProvider>[1],
    {},
  );

const unsign = (keys: AccountMeta[], authority: PublicKey): AccountMeta[] =>
  keys.map((k) => (k.pubkey.equals(authority) ? { ...k, isSigner: false } : k));

interface MintInfo {
  decimals: number;
  tokenProgram: PublicKey;
  /** Issuer transfer fee on `amount`, current epoch. */
  fee: (amount: bigint) => bigint;
}

/**
 * Devnet venue: `mock_swap`. Prices come from its Market accounts, and
 * Token-2022 transfer fees are applied to the expected output like the chain will.
 */
export class MockSwapAdapter implements SwapAdapter {
  readonly program: Program<MockSwap>;
  readonly pdas: MockSwapPdas;
  private mintCache = new Map<string, MintInfo>();

  constructor(
    readonly connection: Connection,
    readonly usdcMint: PublicKey,
    readonly programId: PublicKey = MOCK_SWAP_PROGRAM_ID,
  ) {
    const idl = { ...MOCK_SWAP_IDL, address: programId.toBase58() } as MockSwap;
    this.program = new Program<MockSwap>(idl, readonlyProvider(connection));
    this.pdas = new MockSwapPdas(programId);
  }

  async mintInfo(mint: PublicKey): Promise<MintInfo> {
    const cached = this.mintCache.get(mint.toBase58());
    if (cached) return cached;
    const ai = await this.connection.getAccountInfo(mint);
    if (!ai) throw new Error(`mint ${mint.toBase58()} not found`);
    const parsed = unpackMint(mint, ai, ai.owner);
    const tfc = ai.owner.equals(TOKEN_2022_PROGRAM_ID) ? getTransferFeeConfig(parsed) : null;
    const epoch = tfc ? BigInt((await this.connection.getEpochInfo()).epoch) : 0n;
    const info: MintInfo = {
      decimals: parsed.decimals,
      tokenProgram: ai.owner,
      fee: (amount) => {
        if (!tfc) return 0n;
        const f = epoch >= tfc.newerTransferFee.epoch ? tfc.newerTransferFee : tfc.olderTransferFee;
        return calculateEpochFee(
          { ...tfc, newerTransferFee: f, olderTransferFee: f },
          epoch,
          amount,
        );
      },
    };
    this.mintCache.set(mint.toBase58(), info);
    return info;
  }

  async market(stockMint: PublicKey) {
    return this.program.account.market.fetch(this.pdas.market(stockMint));
  }

  async build(req: SwapRequest): Promise<SwapInstruction> {
    const usdc = this.usdcMint;
    const keep = (bps: number) => 10_000n - BigInt(bps);
    const minOutOf = (x: bigint) => (x * (10_000n - BigInt(req.slippageBps))) / 10_000n;
    const base = {
      user: req.authority,
      state: this.pdas.state(),
      mintAuthority: this.pdas.mintAuthority(),
      source: req.source,
      destination: req.destination,
    };

    if (req.inputMint.equals(usdc) || req.outputMint.equals(usdc)) {
      const buy = req.inputMint.equals(usdc);
      const stock = buy ? req.outputMint : req.inputMint;
      const [info, market] = await Promise.all([this.mintInfo(stock), this.market(stock)]);
      const price = BigInt(market.priceE6.toString());
      const scale = 10n ** BigInt(info.decimals);
      let expected: bigint;
      if (buy) {
        const gross = (((req.amountIn * keep(market.feeBps)) / 10_000n) * scale) / price;
        expected = gross - info.fee(gross);
      } else {
        const received = req.amountIn - info.fee(req.amountIn);
        expected = (((received * price) / scale) * keep(market.feeBps)) / 10_000n;
      }
      const minOut = minOutOf(expected);
      const ix = await this.program.methods
        .swap(new BN(req.amountIn.toString()), new BN(minOut.toString()), buy)
        .accountsPartial({
          ...base,
          market: this.pdas.market(stock),
          usdcMint: usdc,
          stockMint: stock,
          inventory: this.pdas.inventory(stock, info.tokenProgram),
          usdcTokenProgram: TOKEN_PROGRAM_ID,
          stockTokenProgram: info.tokenProgram,
        })
        .instruction();
      return { programId: ix.programId, keys: unsign(ix.keys, req.authority), data: ix.data, expectedOut: expected, minOut, lookupTables: [] };
    }

    const [infoIn, infoOut, mIn, mOut] = await Promise.all([
      this.mintInfo(req.inputMint),
      this.mintInfo(req.outputMint),
      this.market(req.inputMint),
      this.market(req.outputMint),
    ]);
    const received = req.amountIn - infoIn.fee(req.amountIn);
    const usd = (received * BigInt(mIn.priceE6.toString())) / 10n ** BigInt(infoIn.decimals);
    const gross =
      (((usd * keep(mIn.feeBps) * keep(mOut.feeBps)) / 100_000_000n) * 10n ** BigInt(infoOut.decimals)) /
      BigInt(mOut.priceE6.toString());
    const expected = gross - infoOut.fee(gross);
    const minOut = minOutOf(expected);
    const ix = await this.program.methods
      .swapStocks(new BN(req.amountIn.toString()), new BN(minOut.toString()))
      .accountsPartial({
        ...base,
        marketIn: this.pdas.market(req.inputMint),
        marketOut: this.pdas.market(req.outputMint),
        mintIn: req.inputMint,
        mintOut: req.outputMint,
        inventoryIn: this.pdas.inventory(req.inputMint, infoIn.tokenProgram),
        inventoryOut: this.pdas.inventory(req.outputMint, infoOut.tokenProgram),
        tokenProgramIn: infoIn.tokenProgram,
        tokenProgramOut: infoOut.tokenProgram,
      })
      .instruction();
    return { programId: ix.programId, keys: unsign(ix.keys, req.authority), data: ix.data, expectedOut: expected, minOut, lookupTables: [] };
  }
}

interface JupiterIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

/**
 * Mainnet venue: Jupiter v6 via the public quote + swap-instructions API.
 * Uses shared-accounts routing because the authority is a PDA that cannot
 * own Jupiter's intermediate token accounts.
 * NOTE: built to Jupiter's documented API; exercise it on mainnet at small size before relying on it.
 */
export class JupiterAdapter implements SwapAdapter {
  readonly programId = JUPITER_V6_PROGRAM_ID;
  constructor(readonly baseUrl = 'https://lite-api.jup.ag/swap/v1', readonly fetchImpl: typeof fetch = fetch) {}

  async build(req: SwapRequest): Promise<SwapInstruction> {
    const q = new URL(`${this.baseUrl}/quote`);
    q.searchParams.set('inputMint', req.inputMint.toBase58());
    q.searchParams.set('outputMint', req.outputMint.toBase58());
    q.searchParams.set('amount', req.amountIn.toString());
    q.searchParams.set('slippageBps', String(req.slippageBps));
    q.searchParams.set('onlyDirectRoutes', 'false');
    q.searchParams.set('maxAccounts', '30');
    const quoteRes = await this.fetchImpl(q);
    if (!quoteRes.ok) throw new Error(`jupiter quote ${quoteRes.status}: ${await quoteRes.text()}`);
    const quote = (await quoteRes.json()) as { outAmount: string; otherAmountThreshold: string };

    const res = await this.fetchImpl(`${this.baseUrl}/swap-instructions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: req.authority.toBase58(),
        destinationTokenAccount: req.destination.toBase58(),
        useSharedAccounts: true,
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: false,
      }),
    });
    if (!res.ok) throw new Error(`jupiter swap-instructions ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { swapInstruction: JupiterIx; addressLookupTableAddresses: string[] };
    const ix = body.swapInstruction;
    return {
      programId: new PublicKey(ix.programId),
      keys: unsign(
        ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
        req.authority,
      ),
      data: Buffer.from(ix.data, 'base64'),
      expectedOut: BigInt(quote.outAmount),
      minOut: BigInt(quote.otherAmountThreshold),
      lookupTables: body.addressLookupTableAddresses.map((a) => new PublicKey(a)),
    };
  }
}
