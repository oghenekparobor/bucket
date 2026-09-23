// End-to-end flows the app runs, composed from SDK builders: publish, invest
// (open + keeper fills), exit (redeem + keeper fills). Tests use these for the
// happy path and call the builders directly to attack individual steps.

import { AddressLookupTableAccount, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { math, type BucketAccount } from '@bucket/sdk';
import { Chain } from './harness.js';

export interface Published {
  address: PublicKey;
  bucket: BucketAccount;
  table: AddressLookupTableAccount;
}

export async function publish(
  chain: Chain,
  creator: Keypair,
  p: { name: string; thesis?: string; holdings: [symbol: string, pct: number][] },
): Promise<Published> {
  const flow = await chain.client.createBucketFlow({
    creator: creator.publicKey,
    payer: creator.publicKey,
    name: p.name,
    thesis: p.thesis ?? '',
    holdings: p.holdings.map(([s, pct]) => ({ mint: chain.stock(s).mint, weightBps: pct * 100 })),
  });
  // 15 vault ATAs do not fit one transaction next to create_bucket: send them in chunks first.
  for (let i = 0; i < flow.ataIxs.length; i += 5) await chain.send(flow.ataIxs.slice(i, i + 5), [creator]);
  await chain.send([flow.createIx], [creator]);
  const bucket = await chain.client.bucket(flow.bucket);
  const table = await chain.bucketTable(flow.bucket, bucket);
  return { address: flow.bucket, bucket, table };
}

export async function refresh(chain: Chain, b: Published): Promise<Published> {
  return { ...b, bucket: await chain.client.bucket(b.address) };
}

export async function openMint(chain: Chain, backer: Keypair, b: Published, amount: bigint) {
  const config = await chain.client.config();
  const bucket = await chain.client.bucket(b.address);
  const { ix, order } = await chain.client.openMintIx({
    backer: backer.publicKey,
    payer: backer.publicKey,
    bucketAddress: b.address,
    bucket,
    config,
    amountE6: amount,
  });
  await chain.send([ix], [backer], [b.table]);
  return order;
}

/** Keeper fills every open leg of a mint order, one leg per transaction. */
export async function fillMint(chain: Chain, b: Published, order: PublicKey, signer: Keypair = chain.keeper) {
  const config = await chain.client.config();
  let o = await chain.client.mintOrder(order);
  for (let i = 0; i < o.legs.length; i++) {
    if (o.legs[i]!.done) continue;
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillMintIx({
      signer: signer.publicKey,
      bucketAddress: b.address,
      bucket,
      config,
      orderAddress: order,
      order: o,
      leg: i,
      swap: chain.swap,
    });
    await chain.send(f.ixs, [signer], [b.table]);
    o = await chain.client.mintOrder(order);
  }
  return o;
}

export async function closeMint(chain: Chain, order: PublicKey, signer: Keypair = chain.keeper) {
  const config = await chain.client.config();
  const o = await chain.client.mintOrder(order);
  await chain.send([await chain.client.closeMintOrderIx({ signer: signer.publicKey, config, orderAddress: order, order: o })], [signer]);
}

/** open_mint + every fill + close: the whole "Invest" button. Returns tokens received. */
export async function invest(chain: Chain, backer: Keypair, b: Published, amount: bigint): Promise<bigint> {
  const bucket = await chain.client.bucket(b.address);
  const ata = getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey, true);
  const before = chain.tokenBalance(ata);
  const order = await openMint(chain, backer, b, amount);
  await fillMint(chain, b, order);
  await closeMint(chain, order);
  return chain.tokenBalance(ata) - before;
}

export async function redeem(chain: Chain, holder: Keypair, b: Published, tokens: bigint) {
  const bucket = await chain.client.bucket(b.address);
  const { ix, order } = await chain.client.redeemIx({ holder: holder.publicKey, payer: holder.publicKey, bucketAddress: b.address, bucket, tokens });
  await chain.send([ix], [holder], [b.table]);
  return order;
}

export async function fillRedeem(chain: Chain, b: Published, order: PublicKey, signer: Keypair = chain.keeper) {
  const config = await chain.client.config();
  let o = await chain.client.redeemOrder(order);
  for (let i = 0; i < o.legs.length; i++) {
    if (o.legs[i]!.done) continue;
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillRedeemIx({
      signer: signer.publicKey,
      bucketAddress: b.address,
      bucket,
      config,
      orderAddress: order,
      order: o,
      leg: i,
      swap: chain.swap,
    });
    await chain.send(f.ixs, [signer], [b.table]);
    o = await chain.client.redeemOrder(order);
  }
  return o;
}

/** redeem + keeper sells every leg + close: the whole "Sell or redeem" button. Returns USDC received. */
export async function exit(chain: Chain, holder: Keypair, b: Published, tokens: bigint): Promise<bigint> {
  const before = chain.usdcOf(holder.publicKey);
  const order = await redeem(chain, holder, b, tokens);
  const o = await fillRedeem(chain, b, order);
  await chain.send([await chain.client.closeRedeemOrderIx(order, o)], [holder]);
  return chain.usdcOf(holder.publicKey) - before;
}

export async function settle(chain: Chain, b: Published) {
  const bucket = await chain.client.bucket(b.address);
  await chain.send([await chain.client.settleIx(b.address, bucket)], [chain.keeper], [b.table]);
}

/** Vault value (spot), supply and unit price as the program sees them. */
export async function snapshot(chain: Chain, b: Published) {
  const bucket = await chain.client.bucket(b.address);
  const holdings = await chain.client.holdingStates(b.address, bucket);
  const value = math.vaultValueE6(holdings);
  const supply = chain.supplyOf(bucket.tokenMint);
  return { bucket, holdings, value, supply, unit: math.unitPriceE6(value, supply), hwm: BigInt(bucket.hwmE6.toString()) };
}
