// Admin reset of on-chain prices (and the devnet venue) for listed mints, for
// corporate actions or to undo a bad feed. Reads `{ "<mint>": <priceE6>, ... }`
// from a JSON file and sends force_price (admin) + mock_swap set_price.
//
//   pnpm exec tsx force-prices.ts --prices prices.json [--cluster localnet]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import BN from 'bn.js';
import { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';

import { BucketClient, MockSwapAdapter } from '@bucket/sdk';
import type { Deployment } from './setup.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
};
const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(here, '..', '..', 'keys', `${name}.json`), 'utf8'))));

async function main() {
  const cluster = arg('cluster', 'localnet');
  const dep = JSON.parse(readFileSync(join(here, '..', 'deployments', `${cluster}.json`), 'utf8')) as Deployment;
  const prices = JSON.parse(readFileSync(arg('prices'), 'utf8')) as Record<string, number | string>;
  const connection = new Connection(process.env.RPC_URL ?? dep.rpcUrl, 'confirmed');
  const client = new BucketClient(connection);
  const config = await client.config();
  const admin = key('deployer');
  const priceAuthority = key('price-authority');
  const swap = cluster === 'mainnet-beta' ? null : new MockSwapAdapter(connection, config.usdcMint);

  for (const [mint, raw] of Object.entries(prices)) {
    const priceE6 = BigInt(raw);
    const m = new PublicKey(mint);
    const ixs: TransactionInstruction[] = [await client.updatePriceIx(admin.publicKey, m, priceE6, true)];
    if (swap) {
      ixs.push(
        await swap.program.methods
          .setPrice(new BN(priceE6.toString()))
          .accountsPartial({ signer: priceAuthority.publicKey, state: swap.pdas.state(), market: swap.pdas.market(m) })
          .instruction(),
      );
    }
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = BucketClient.v0({ payer: admin.publicKey, ixs, blockhash });
    tx.sign(swap ? [admin, priceAuthority] : [admin]);
    const sig = await connection.sendTransaction(tx);
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`${mint} → $${(Number(priceE6) / 1e6).toFixed(4)}  ${sig}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
