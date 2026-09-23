// Spike 0.3: create a Meteora DAMM v2 pool for a program-minted token against
// USDC with the Meteora SDK, then quote and execute a swap through it.
// Runs on devnet (DAMM v2 is deployed there). Uses a scratch wallet funded from
// the local Solana CLI wallet; writes results to docs/spikes/meteora-pool.json.
//
//   pnpm exec tsx spike-meteora.ts [--seed-usd 1000]

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import BN from 'bn.js';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  deriveCustomizablePoolAddress,
  getBaseFeeParams,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
} from '@meteora-ag/cp-amm-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/id.json'), 'utf8'))));
  const me = Keypair.generate();
  const startSol = 0.3 * LAMPORTS_PER_SOL;
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: me.publicKey, lamports: startSol })), [funder]);

  const seedUsd = Number(arg('seed-usd', '1000'));
  const unitPrice = 100; // a fresh bucket token is worth $100
  // "bucket token": classic SPL, 6 dp, like the program mints. Seed supply is minted
  // before mint authority moves to a PDA, as it would at publish.
  const bucketMint = await createMint(connection, me, me.publicKey, null, 6);
  const usdc = await createMint(connection, me, me.publicKey, null, 6);
  const myBucket = getAssociatedTokenAddressSync(bucketMint, me.publicKey);
  const myUsdc = getAssociatedTokenAddressSync(usdc, me.publicKey);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(me.publicKey, myBucket, me.publicKey, bucketMint),
      createAssociatedTokenAccountIdempotentInstruction(me.publicKey, myUsdc, me.publicKey, usdc),
    ),
    [me],
  );
  const seedTokens = BigInt(Math.round((seedUsd / unitPrice) * 1e6));
  const seedUsdc = BigInt(Math.round(seedUsd * 1e6));
  await mintTo(connection, me, bucketMint, myBucket, me, seedTokens * 2n);
  await mintTo(connection, me, usdc, myUsdc, me, seedUsdc * 2n);
  const pdaAuthority = PublicKey.findProgramAddressSync([Buffer.from('bucket_mint_authority')], SystemProgram.programId)[0];
  await sendAndConfirmTransaction(connection, new Transaction().add(createSetAuthorityInstruction(bucketMint, me.publicKey, AuthorityType.MintTokens, pdaAuthority)), [me]);

  const cpAmm = new CpAmm(connection);
  const tokenAAmount = new BN(seedTokens.toString());
  const tokenBAmount = new BN(seedUsdc.toString());
  const { initSqrtPrice, liquidityDelta } = cpAmm.preparePoolCreationParams({
    tokenAAmount,
    tokenBAmount,
    minSqrtPrice: MIN_SQRT_PRICE,
    maxSqrtPrice: MAX_SQRT_PRICE,
    collectFeeMode: CollectFeeMode.OnlyB,
  });
  const positionNft = Keypair.generate();
  const baseFee = getBaseFeeParams({
    baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
    feeTimeSchedulerParam: { startingFeeBps: 30, endingFeeBps: 30, numberOfPeriod: 0, totalDuration: 0 },
  });
  const { tx, pool, position } = await cpAmm.createCustomPool({
    payer: me.publicKey,
    creator: me.publicKey,
    positionNft: positionNft.publicKey,
    tokenAMint: bucketMint,
    tokenBMint: usdc,
    tokenAAmount,
    tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta,
    initSqrtPrice,
    poolFees: { baseFee, compoundingFeeBps: 0, padding: 0, dynamicFee: null },
    hasAlphaVault: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: CollectFeeMode.OnlyB,
    activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: false,
  });
  const createSig = await sendAndConfirmTransaction(connection, tx, [me, positionNft]);
  const derived = deriveCustomizablePoolAddress(bucketMint, usdc);

  const poolState = await cpAmm.fetchPoolState(pool);
  const slot = await connection.getSlot();
  const now = Math.floor(Date.now() / 1000);
  const quotes: Record<string, unknown>[] = [];
  for (const usdIn of [1, 10, 100, 250]) {
    const q = cpAmm.getQuote({ inAmount: new BN(usdIn * 1e6), inputTokenMint: usdc, slippage: 1, poolState, currentTime: now, currentSlot: slot, tokenADecimal: 6, tokenBDecimal: 6 });
    const tokensOut = Number(q.swapOutAmount.toString()) / 1e6;
    quotes.push({ usdIn, tokensOut, effectivePrice: +(usdIn / tokensOut).toFixed(4), premiumVsUnitPct: +((usdIn / tokensOut / unitPrice - 1) * 100).toFixed(3), priceImpactPct: +q.priceImpact.toFixed(4) });
  }

  // execute the $10 buy
  const q10 = cpAmm.getQuote({ inAmount: new BN(10e6), inputTokenMint: usdc, slippage: 1, poolState, currentTime: now, currentSlot: slot, tokenADecimal: 6, tokenBDecimal: 6 });
  const swapTx = await cpAmm.swap({
    payer: me.publicKey,
    pool,
    inputTokenMint: usdc,
    outputTokenMint: bucketMint,
    amountIn: new BN(10e6),
    minimumAmountOut: q10.minSwapOutAmount,
    tokenAMint: bucketMint,
    tokenBMint: usdc,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    referralTokenAccount: null,
  });
  const before = BigInt((await connection.getTokenAccountBalance(myBucket)).value.amount);
  const swapSig = await sendAndConfirmTransaction(connection, swapTx, [me]);
  const after = BigInt((await connection.getTokenAccountBalance(myBucket)).value.amount);
  const spentSol = (startSol - (await connection.getBalance(me.publicKey))) / LAMPORTS_PER_SOL;

  const report = {
    date: new Date().toISOString(),
    cluster: 'devnet',
    program: 'DAMM v2 (cp-amm) via @meteora-ag/cp-amm-sdk 1.4.9, createCustomPool (no Meteora config account needed)',
    bucketMint: bucketMint.toBase58(),
    mintAuthorityMovedToPda: pdaAuthority.toBase58(),
    usdcMint: usdc.toBase58(),
    pool: pool.toBase58(),
    poolMatchesDerivedAddress: pool.equals(derived),
    position: position.toBase58(),
    seed: { usd: seedUsd, tokens: Number(seedTokens) / 1e6, usdc: Number(seedUsdc) / 1e6, fullRange: true, feeBps: 30, collectFeeMode: 'OnlyB (fees in USDC)' },
    createTx: createSig,
    quotes,
    executedSwap: { usdIn: 10, tokensOut: Number(after - before) / 1e6, sig: swapSig },
    solSpentIncludingRent: +spentSol.toFixed(5),
  };
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(here, '..', '..', 'docs', 'spikes', 'meteora-pool.json'), JSON.stringify(report, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
