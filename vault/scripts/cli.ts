// Self-custody CLI. With nothing but an exported wallet key and an RPC URL,
// a holder can see a position, redeem, sell their own slice, or take the
// underlying tokens in kind — no Bucket API, keeper or web app involved.
//
//   pnpm cli position --bucket <address> --keypair ~/exported.json
//   pnpm cli redeem   --bucket <address> --tokens all --keypair ~/exported.json
//   pnpm cli claim    --order <redeem order> --keypair ~/exported.json        # tokens in kind
//   pnpm cli sell     --order <redeem order> --keypair ~/exported.json [--venue mock|jupiter]
//   pnpm cli invest   --bucket <address> --usd 25 --keypair ~/exported.json [--venue mock|jupiter]
//   pnpm cli faucet   --usd 1000 --keypair ~/exported.json                    # devnet only
//
// RPC: --rpc <url> or RPC_URL (default devnet).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import BN from 'bn.js';
import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { BucketClient, JupiterAdapter, math, MockSwapAdapter, type SwapAdapter } from '@bucket/sdk';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const need = (name: string) => {
  const v = opt(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
};
const fmtUsd = (e6: bigint) => `$${(Number(e6) / 1e6).toFixed(2)}`;

async function main() {
  const connection = new Connection(opt('rpc') ?? process.env.RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
  const keyPath = need('keypair').replace(/^~/, homedir());
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
  const client = new BucketClient(connection);
  const config = await client.config();
  const venue: SwapAdapter = opt('venue') === 'jupiter' ? new JupiterAdapter() : new MockSwapAdapter(connection, config.usdcMint);

  const send = async (ixs: TransactionInstruction[], lookupTables: PublicKey[] = []) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tables = await client.loadLookupTables(lookupTables);
    const tx = BucketClient.v0({ payer: wallet.publicKey, ixs, blockhash, lookupTables: tables });
    tx.sign([wallet]);
    const sig = await connection.sendTransaction(tx);
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  };

  /** Large buckets need a lookup table; the CLI makes its own so it depends on nothing Bucket runs. */
  const bucketTables = async (address: PublicKey, bucket: Awaited<ReturnType<BucketClient['bucket']>>) => {
    if (bucket.holdings.length <= 6) return [];
    const slot = await connection.getSlot('finalized');
    const t = client.lookupTableIxs(wallet.publicKey, wallet.publicKey, slot, client.lookupTableAddresses(address, bucket, config));
    await send([t.create]);
    for (const e of t.extends) await send([e]); // one per transaction: create + a full extend does not fit
    await new Promise((r) => setTimeout(r, 1_000)); // tables activate on the next slot
    return [t.table];
  };

  switch (cmd) {
    case 'position': {
      const address = new PublicKey(need('bucket'));
      const bucket = await client.bucket(address);
      const holdings = await client.holdingStates(address, bucket);
      const supply = await client.supply(bucket);
      const unit = math.unitPriceE6(math.vaultValueE6(holdings), supply);
      const ata = getAssociatedTokenAddressSync(bucket.tokenMint, wallet.publicKey);
      const bal = BigInt((await connection.getTokenAccountBalance(ata).catch(() => ({ value: { amount: '0' } }))).value.amount);
      console.log(`${bucket.name}: ${Number(bal) / 1e6} tokens × ${fmtUsd(unit)} = ${fmtUsd((bal * unit) / 1_000_000n)}`);
      break;
    }
    case 'redeem': {
      const address = new PublicKey(need('bucket'));
      const bucket = await client.bucket(address);
      const ata = getAssociatedTokenAddressSync(bucket.tokenMint, wallet.publicKey);
      const bal = BigInt((await connection.getTokenAccountBalance(ata)).value.amount);
      const t = need('tokens');
      const tokens = t === 'all' ? bal : BigInt(Math.round(Number(t) * 1e6));
      const { ix, order } = await client.redeemIx({ holder: wallet.publicKey, payer: wallet.publicKey, bucketAddress: address, bucket, tokens });
      const usdcAta = getAssociatedTokenAddressSync(config.usdcMint, wallet.publicKey);
      const sig = await send(
        [createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, usdcAta, wallet.publicKey, config.usdcMint), ix],
        await bucketTables(address, bucket),
      );
      console.log(`redeemed ${Number(tokens) / 1e6} tokens: order ${order.toBase58()} (${sig})`);
      console.log(`next: 'sell --order ${order.toBase58()}' for USDC, or 'claim --order ${order.toBase58()}' for the tokens themselves`);
      break;
    }
    case 'claim': {
      const orderAddress = new PublicKey(need('order'));
      const order = await client.redeemOrder(orderAddress);
      const bucket = await client.bucket(order.bucket);
      for (let leg = 0; leg < order.legs.length; leg++) {
        if (order.legs[leg]!.done) continue;
        const ixs = await client.claimInKindIxs({ holder: wallet.publicKey, payer: wallet.publicKey, bucketAddress: order.bucket, bucket, orderAddress, order, leg });
        console.log(`leg ${leg}: ${await send(ixs)}`);
      }
      break;
    }
    case 'sell': {
      const orderAddress = new PublicKey(need('order'));
      let order = await client.redeemOrder(orderAddress);
      const bucket = await client.bucket(order.bucket);
      for (let leg = 0; leg < order.legs.length; leg++) {
        if (order.legs[leg]!.done) continue;
        const f = await client.fillRedeemIx({ signer: wallet.publicKey, bucketAddress: order.bucket, bucket, config, orderAddress, order, leg, swap: venue });
        console.log(`leg ${leg}: ${await send(f.ixs, f.lookupTables)}`);
        order = await client.redeemOrder(orderAddress);
      }
      break;
    }
    case 'invest': {
      const address = new PublicKey(need('bucket'));
      const bucket = await client.bucket(address);
      const amount = BigInt(Math.round(Number(need('usd')) * 1e6));
      const { ix, order } = await client.openMintIx({ backer: wallet.publicKey, payer: wallet.publicKey, bucketAddress: address, bucket, config, amountE6: amount });
      console.log(`opened ${order.toBase58()}: ${await send([ix], await bucketTables(address, bucket))}`);
      let o = await client.mintOrder(order);
      for (let leg = 0; leg < o.legs.length; leg++) {
        if (o.legs[leg]!.done) continue;
        const f = await client.fillMintIx({ signer: wallet.publicKey, bucketAddress: address, bucket, config, orderAddress: order, order: o, leg, swap: venue });
        console.log(`leg ${leg}: ${await send(f.ixs, f.lookupTables)}`);
        o = await client.mintOrder(order);
      }
      console.log(`closed: ${await send([await client.closeMintOrderIx({ signer: wallet.publicKey, config, orderAddress: order, order: o })])}`);
      break;
    }
    case 'faucet': {
      const swap = new MockSwapAdapter(connection, config.usdcMint);
      const ata = getAssociatedTokenAddressSync(config.usdcMint, wallet.publicKey);
      const amount = BigInt(Math.round(Number(need('usd')) * 1e6));
      const ix = await swap.program.methods
        .faucet(new BN(amount.toString()))
        .accountsPartial({ state: swap.pdas.state(), mintAuthority: swap.pdas.mintAuthority(), usdcMint: config.usdcMint, destination: ata, tokenProgram: TOKEN_PROGRAM_ID })
        .instruction();
      console.log(await send([createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, wallet.publicKey, config.usdcMint), ix]));
      break;
    }
    default:
      console.log('commands: position | redeem | claim | sell | invest | faucet  (see header of cli.ts)');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
