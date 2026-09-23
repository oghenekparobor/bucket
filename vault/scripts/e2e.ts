// Phase 1 goal against a real cluster (localnet or devnet), two separate wallets:
// a creator builds a bucket, a second wallet mints tokens, prices rise, the
// backer redeems at a gain, and the creator receives commission tokens.
//
//   pnpm exec tsx e2e.ts [--cluster devnet]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import BN from 'bn.js';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { BucketClient, decodeEvents, math, MockSwapAdapter, type BucketEvent } from '@bucket/sdk';
import type { Deployment } from './setup.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(here, '..', '..', 'keys', `${name}.json`), 'utf8'))));
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const fmt = (e6: bigint) => `$${(Number(e6) / 1e6).toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cluster = arg('cluster', 'localnet');
  const dep = JSON.parse(readFileSync(join(here, '..', 'deployments', `${cluster}.json`), 'utf8')) as Deployment;
  const connection = new Connection(process.env.RPC_URL ?? dep.rpcUrl, 'confirmed');
  const client = new BucketClient(connection);
  const config = await client.config();
  const swap = new MockSwapAdapter(connection, config.usdcMint);
  const deployer = key('deployer');
  const keeper = key('keeper');
  const priceAuthority = key('price-authority');
  const creator = Keypair.generate();
  const backer = Keypair.generate();
  const events: BucketEvent[] = [];

  // Public devnet RPCs are load-balanced and flaky: retry sends that never landed.
  const send = async (ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[] = []) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = BucketClient.v0({ payer: signers[0]!.publicKey, ixs, blockhash, lookupTables: tables });
        tx.sign(signers);
        const sig = await connection.sendTransaction(tx);
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        if (res.value.err) throw new Error(`${sig} failed: ${JSON.stringify(res.value.err)}`);
        let t = null;
        for (let i = 0; i < 10 && !t; i++) {
          t = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
          if (!t) await sleep(1_000);
        }
        events.push(...decodeEvents(t?.meta?.logMessages ?? []));
        return sig;
      } catch (e) {
        const msg = String(e);
        if (attempt >= 6 || !/Blockhash not found|block height exceeded|fetch failed|429|Too many|ECONNRESET|socket hang up/i.test(msg)) throw e;
        await sleep(3_000 * attempt);
      }
    }
  };

  // wallets: SOL from the deployer, mock USDC from the faucet
  await send(
    [creator, backer].map((k) => SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: k.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })),
    [deployer],
  );
  for (const [who, amount] of [[creator, usd(1_000)], [backer, usd(2_000)]] as const) {
    const ata = getAssociatedTokenAddressSync(config.usdcMint, who.publicKey);
    await send(
      [
        createAssociatedTokenAccountIdempotentInstruction(who.publicKey, ata, who.publicKey, config.usdcMint),
        await swap.program.methods
          .faucet(new BN(amount.toString()))
          .accountsPartial({ state: swap.pdas.state(), mintAuthority: swap.pdas.mintAuthority(), usdcMint: config.usdcMint, destination: ata, tokenProgram: TOKEN_PROGRAM_ID })
          .instruction(),
      ],
      [who],
    );
  }
  console.log(`creator ${creator.publicKey.toBase58()}  backer ${backer.publicKey.toBase58()}`);

  // 1. creator publishes
  const pick = ['NVDAx', 'MSFTx', 'pANTHROPIC', 'pSPACEX'];
  const weights = [3_000, 2_500, 2_500, 2_000];
  const mints = pick.map((s) => new PublicKey(dep.tokens.find((t) => t.symbol === s)!.mint));
  // the venue must quote at the price the program accepted (after its ±20% clamp), as the price pusher keeps it
  for (const mint of mints) {
    const a = await client.asset(mint);
    await send(
      [await swap.program.methods.setPrice(a.priceE6).accountsPartial({ signer: priceAuthority.publicKey, state: swap.pdas.state(), market: swap.pdas.market(mint) }).instruction()],
      [priceAuthority],
    );
  }
  const flow = await client.createBucketFlow({
    creator: creator.publicKey,
    payer: creator.publicKey,
    name: 'Frontier Labs (e2e)',
    thesis: 'Compute and the models that run on it.',
    holdings: mints.map((mint, i) => ({ mint, weightBps: weights[i]! })),
  });
  await send(flow.ataIxs, [creator]);
  await send([flow.createIx], [creator]);
  let bucket = await client.bucket(flow.bucket);
  const slot = await connection.getSlot('finalized');
  const t = client.lookupTableIxs(creator.publicKey, creator.publicKey, slot, client.lookupTableAddresses(flow.bucket, bucket, config));
  await send([t.create], [creator]);
  for (const e of t.extends) await send([e], [creator]); // one per transaction: create + a full extend does not fit
  // a new lookup table is usable once the next slot is rooted: ~1 s on localnet, ~13 s on devnet
  await sleep(cluster === 'localnet' ? 1_500 : 15_000);
  const tables = await client.loadLookupTables([t.table]);
  console.log(`1. published ${bucket.name} at ${flow.bucket.toBase58()} (lookup table ${t.table.toBase58()})`);

  const invest = async (who: Keypair, amount: bigint) => {
    const { ix, order } = await client.openMintIx({ backer: who.publicKey, payer: who.publicKey, bucketAddress: flow.bucket, bucket, config, amountE6: amount });
    await send([ix], [who], tables);
    let o = await client.mintOrder(order);
    for (let leg = 0; leg < o.legs.length; leg++) {
      const f = await client.fillMintIx({ signer: keeper.publicKey, bucketAddress: flow.bucket, bucket, config, orderAddress: order, order: o, leg, swap });
      await send(f.ixs, [keeper], tables);
      o = await client.mintOrder(order);
    }
    await send([await client.closeMintOrderIx({ signer: keeper.publicKey, config, orderAddress: order, order: o })], [keeper]);
    return BigInt(o.tokensIssued.toString());
  };
  const state = async () => {
    bucket = await client.bucket(flow.bucket);
    const hs = await client.holdingStates(flow.bucket, bucket);
    const supply = await client.supply(bucket);
    return { supply, unit: math.unitPriceE6(math.vaultValueE6(hs), supply) };
  };

  // 2. creator funds, 3. a second wallet invests
  const c = await invest(creator, usd(500));
  console.log(`2. creator minted ${Number(c) / 1e6} tokens for $500 — unit price ${fmt((await state()).unit)}`);
  const b = await invest(backer, usd(1_500));
  console.log(`3. backer minted ${Number(b) / 1e6} tokens for $1,500 — unit price ${fmt((await state()).unit)}`);

  // 4. prices rise 15% and stay there. Commission values the vault at min(spot, TWAP),
  // so a fresh push pays nothing until it has held for the 30-minute TWAP window; the
  // admin's force_price stands in for "the rise has persisted" so this runs in seconds.
  // (vault/tests/src/edits.test.ts covers the real TWAP path with clock warps.)
  const deployerAdmin = deployer;
  for (const mint of mints) {
    const a = await client.asset(mint);
    const p = (BigInt(a.priceE6.toString()) * 115n) / 100n;
    await send(
      [
        await client.updatePriceIx(deployerAdmin.publicKey, mint, p, true),
        await swap.program.methods.setPrice(new BN(p.toString())).accountsPartial({ signer: priceAuthority.publicKey, state: swap.pdas.state(), market: swap.pdas.market(mint) }).instruction(),
      ],
      [priceAuthority, deployerAdmin],
    );
  }
  console.log(`4. prices +15%, sustained — unit price ${fmt((await state()).unit)}`);

  // 5. backer redeems everything; commission settles first
  const ata = getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey);
  const held = BigInt((await connection.getTokenAccountBalance(ata)).value.amount);
  const usdcBefore = BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey))).value.amount);
  const { ix, order } = await client.redeemIx({ holder: backer.publicKey, payer: backer.publicKey, bucketAddress: flow.bucket, bucket, tokens: held });
  await send([ix], [backer], tables);
  let ro = await client.redeemOrder(order);
  for (let leg = 0; leg < ro.legs.length; leg++) {
    const f = await client.fillRedeemIx({ signer: keeper.publicKey, bucketAddress: flow.bucket, bucket, config, orderAddress: order, order: ro, leg, swap });
    await send(f.ixs, [keeper], tables);
    ro = await client.redeemOrder(order);
  }
  await send([await client.closeRedeemOrderIx(order, ro)], [backer]);
  const usdcAfter = BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey))).value.amount);
  const gain = usdcAfter - usdcBefore - usd(1_500);
  console.log(`5. backer redeemed ${Number(held) / 1e6} tokens for ${fmt(usdcAfter - usdcBefore)} (gain ${fmt(gain)})`);

  // 6. the creator's commission
  const settled = events.filter((e) => e.name === 'CommissionSettled').at(-1)?.data as Record<string, string> | undefined;
  const owed = BigInt((await connection.getTokenAccountBalance(client.pdas.creatorFee(flow.bucket))).value.amount);
  console.log(`6. commission settled: ${settled ? fmt(BigInt(settled.commission_e6!)) : 'none'}; creator fee account holds ${Number(owed) / 1e6} tokens`);
  await send(await client.claimFeesIxs({ signer: creator.publicKey, payer: creator.publicKey, bucketAddress: flow.bucket, bucket, config, creator: true }), [creator]);
  const creatorTokens = BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(bucket.tokenMint, creator.publicKey))).value.amount);
  console.log(`   creator claimed: wallet now holds ${Number(creatorTokens) / 1e6} bucket tokens (${Number(c) / 1e6} bought + ${Number(owed) / 1e6} commission)`);

  if (gain <= 0n) throw new Error('backer did not redeem at a gain');
  if (owed <= 0n) throw new Error('creator received no commission');
  console.log(`PASS — ${events.length} program events emitted`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
