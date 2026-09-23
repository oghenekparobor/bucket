// Failure modes from the checklist: failed swap leg, slippage breach,
// zero-liquidity token, mint and redeem in the same slot, dust amounts, plus
// stale prices, expiry, issuer transfer fees and the keeper-free exit.

import { beforeAll, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { Chain, DESIGN_STOCKS, usd } from './harness.js';
import { closeMint, fillMint, fillRedeem, invest, openMint, publish, redeem, snapshot, exit, type Published } from './flows.js';

describe('failure modes', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot([
      ...DESIGN_STOCKS,
      // A catalog token whose only venue quotes far from its on-chain price: no fill within bounds.
      { symbol: 'ILLIQ', price: 50, source: 'xStocks', kind: 'publicStock' },
    ]);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(10_000));
    await chain.faucet(backer.publicKey, usd(10_000));
    b = await publish(chain, creator, { name: 'Failures', holdings: [['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]] });
    await invest(chain, creator, b, usd(1_000));
  });

  const legFill = async (order: Awaited<ReturnType<typeof openMint>>, leg: number, bucket: Published = b) => {
    const config = await chain.client.config();
    const o = await chain.client.mintOrder(order);
    const bk = await chain.client.bucket(bucket.address);
    return chain.client.fillMintIx({ signer: chain.keeper.publicKey, bucketAddress: bucket.address, bucket: bk, config, orderAddress: order, order: o, leg, swap: chain.swap });
  };

  it('slippage breach: a leg that fills more than 1% worse than the on-chain price is rejected, and its USDC comes back', async () => {
    // the venue now quotes NVDA 3% above the on-chain reference price
    await chain.setPrice('NVDAx', 184.2 * 1.03, { marketOnly: true });
    const usdcBefore = chain.usdcOf(backer.publicKey);
    const order = await openMint(chain, backer, b, usd(1_000));
    const f = await legFill(order, 0);
    expect(await chain.expectError(f.ixs, [chain.keeper], [b.table])).toBe('SlippageExceeded');
    // the other legs still fill and pay tokens
    for (const leg of [1, 2]) await chain.send((await legFill(order, leg)).ixs, [chain.keeper], [b.table]);
    const o = await chain.client.mintOrder(order);
    expect(o.legs[0]!.done).toBe(false);
    expect(BigInt(o.tokensIssued.toString())).toBeGreaterThan(0n);
    // keeper abandons the failed leg: the unfilled USDC goes straight back
    await closeMint(chain, order);
    const refunded = chain.eventsNamed('MintClosed').at(-1)!.data as Record<string, string>;
    expect(BigInt(refunded.refunded_e6!)).toBe(BigInt(o.legs[0]!.budgetE6.toString()));
    expect(usdcBefore - chain.usdcOf(backer.publicKey)).toBeLessThan(usd(1_000) - BigInt(o.legs[0]!.budgetE6.toString()) + usd(3));
    await chain.setPrice('NVDAx', 184.2, { marketOnly: true });
  });

  it('failed swap leg: the swap itself fails (min out not met), nothing moves, the order stays refundable', async () => {
    const order = await openMint(chain, backer, b, usd(200));
    const f = await legFill(order, 1);
    // tamper: demand more output than the venue will give
    const data = Buffer.from(f.ixs[0]!.data);
    const swapDataOffset = 8 + 1 + 8 + 8 + 4; // disc, leg, usdc_in, min_out, vec len
    data.writeBigUInt64LE(10n ** 15n, swapDataOffset + 8 + 8); // mock swap min_out
    f.ixs[0]!.data = data;
    const err = await chain.expectError(f.ixs, [chain.keeper], [b.table]);
    expect(err).toBe('SlippageExceeded'); // mock_swap's own error
    const o = await chain.client.mintOrder(order);
    expect(o.legs.every((l) => l.spentE6.toString() === '0')).toBe(true);
    const before = chain.usdcOf(backer.publicKey);
    await closeMint(chain, order, backer); // the backer can cancel their own order too
    expect(chain.usdcOf(backer.publicKey) - before).toBe(BigInt(o.usdcTotalE6.toString()));
  });

  it('zero-liquidity token: no route exists, the leg cannot fill, the backer is refunded that leg', async () => {
    const illiq = await publish(chain, creator, { name: 'Thin', holdings: [['NVDAx', 50], ['ILLIQ', 50]] });
    // no liquidity within 1% of the on-chain price: the venue quotes 50% away
    await chain.setPrice('ILLIQ', 50 * 1.5, { marketOnly: true });
    const order = await openMint(chain, creator, illiq, usd(100));
    const o = await chain.client.mintOrder(order);
    const nv = o.legs.findIndex((l) => l.mint.equals(chain.stock('NVDAx').mint));
    await chain.send((await legFill(order, nv, illiq)).ixs, [chain.keeper], [illiq.table]);
    expect(await chain.expectError((await legFill(order, 1 - nv, illiq)).ixs, [chain.keeper], [illiq.table])).toBe('SlippageExceeded');
    const before = chain.usdcOf(creator.publicKey);
    await closeMint(chain, order);
    expect(chain.usdcOf(creator.publicKey) - before).toBe(BigInt(o.legs[1 - nv]!.budgetE6.toString()));
  });

  it('mint and redeem in the same slot: round trip costs only fees and swap costs, and nobody else moves', async () => {
    const other = await snapshot(chain, b);
    const bucket = await chain.client.bucket(b.address);
    const ata = getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey);
    const tokensBefore = chain.tokenBalance(ata);
    const slot = chain.svm.getClock().slot;
    const tokens = await invest(chain, backer, b, usd(500));
    const got = await exit(chain, backer, b, tokens);
    expect(chain.svm.getClock().slot).toBe(slot);
    expect(chain.tokenBalance(ata)).toBe(tokensBefore);
    // $500 in, 0.20% fee + ~10 bps each way + 1% SpaceX transfer fee on 25% each way ≈ 1.1%
    expect(got).toBeGreaterThan(usd(490));
    expect(got).toBeLessThan(usd(500));
    const after = await snapshot(chain, b);
    expect(after.unit).toBeGreaterThanOrEqual(other.unit - 1n);
  });

  it('dust: a $1 mint fills; a 1-unit redeem burns and closes with nothing owed', async () => {
    const t = await invest(chain, backer, b, usd(1));
    expect(t).toBeGreaterThan(0n);
    const order = await redeem(chain, backer, b, 1n);
    const o = await chain.client.redeemOrder(order);
    expect(o.legs.every((l) => l.done)).toBe(true);
    await chain.send([await chain.client.closeRedeemOrderIx(order, o)], [backer]);
  });

  it('dust: the smallest possible leg ($1 × 2% = 2 cents) still fills and issues tokens', async () => {
    const wide = await publish(chain, creator, { name: 'Wide', holdings: [['NVDAx', 50], ['AAPLx', 48], ['MSFTx', 2]] });
    await invest(chain, creator, wide, usd(25));
    const order = await openMint(chain, backer, wide, usd(1));
    const o = await chain.client.mintOrder(order);
    const small = o.legs.find((l) => l.mint.equals(chain.stock('MSFTx').mint))!;
    expect(BigInt(small.budgetE6.toString())).toBeLessThan(usd(0.03));
    const filled = await fillMint(chain, wide, order);
    expect(filled.legs.every((l) => l.done)).toBe(true);
    expect(BigInt(filled.tokensIssued.toString())).toBeGreaterThan(0n);
    await closeMint(chain, order);
  });

  it('issuer transfer fee: a PreStocks leg needs its extra-cost allowance to clear the 1% bound', async () => {
    await chain.send(
      [await chain.client.setAssetStatusIx({ admin: chain.admin.publicKey, mint: chain.stock('pSPACEX').mint, enabled: true, flagged: false, extraCostBps: 0 })],
      [chain.admin],
    );
    const order = await openMint(chain, backer, b, usd(300));
    const o = await chain.client.mintOrder(order);
    const sp = o.legs.findIndex((l) => l.mint.equals(chain.stock('pSPACEX').mint));
    expect(await chain.expectError((await legFill(order, sp)).ixs, [chain.keeper], [b.table])).toBe('SlippageExceeded');
    await chain.send(
      [await chain.client.setAssetStatusIx({ admin: chain.admin.publicKey, mint: chain.stock('pSPACEX').mint, enabled: true, flagged: false, extraCostBps: 100 })],
      [chain.admin],
    );
    await chain.send((await legFill(order, sp)).ixs, [chain.keeper], [b.table]);
    await fillMint(chain, b, order);
    await closeMint(chain, order);
  });

  it('expired orders cannot fill; anyone can refund them to the backer', async () => {
    const order = await openMint(chain, backer, b, usd(100));
    chain.advance(601);
    expect(await chain.expectError((await legFill(order, 0)).ixs, [chain.keeper], [b.table])).toBe('OrderExpired');
    const stranger = chain.user();
    const before = chain.usdcOf(backer.publicKey);
    const o = await chain.client.mintOrder(order);
    await chain.send([await chain.client.closeMintOrderIx({ signer: stranger.publicKey, config: await chain.client.config(), orderAddress: order, order: o })], [stranger]);
    expect(chain.usdcOf(backer.publicKey) - before).toBe(BigInt(o.usdcTotalE6.toString()));
    // and a stranger cannot close a live order
    const live = await openMint(chain, backer, b, usd(10));
    const lo = await chain.client.mintOrder(live);
    expect(await chain.expectError([await chain.client.closeMintOrderIx({ signer: stranger.publicKey, config: await chain.client.config(), orderAddress: live, order: lo })], [stranger])).toBe('OrderNotFinished');
    await closeMint(chain, live);
  });

  it('stale prices block mints and keeper sells, never the exit', async () => {
    chain.advance(3_601);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const { ix } = await chain.client.openMintIx({ backer: backer.publicKey, payer: backer.publicKey, bucketAddress: b.address, bucket, config, amountE6: usd(10) });
    expect(await chain.expectError([ix], [backer], [b.table])).toBe('StalePrice');
    expect(await chain.expectError([await chain.client.settleIx(b.address, bucket)], [chain.keeper], [b.table])).toBe('StalePrice');

    const ata = getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey);
    const held = chain.tokenBalance(ata);
    const order = await redeem(chain, backer, b, held);
    const ev = chain.eventsNamed('Redeemed').at(-1)!.data as Record<string, unknown>;
    expect(ev.settled).toBe(false);
    const o = await chain.client.redeemOrder(order);
    const f = await chain.client.fillRedeemIx({ signer: chain.keeper.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    expect(await chain.expectError(f.ixs, [chain.keeper], [b.table])).toBe('StalePrice');
    // the holder sells a leg themselves (their own min-out), and takes the rest in kind
    const own = await chain.client.fillRedeemIx({ signer: backer.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    await chain.send(own.ixs, [backer], [b.table]);
    for (const leg of [1, 2]) {
      await chain.send(await chain.client.claimInKindIxs({ holder: backer.publicKey, payer: backer.publicKey, bucketAddress: b.address, bucket, orderAddress: order, order: o, leg }), [backer]);
      const s = chain.stock(leg === 1 ? 'AAPLx' : 'pSPACEX');
      const got = chain.tokenBalance(getAssociatedTokenAddressSync(s.mint, backer.publicKey, false, s.tokenProgram));
      expect(got).toBeGreaterThan(0n);
    }
    const done = await chain.client.redeemOrder(order);
    expect(done.legs.every((l) => l.done)).toBe(true);
    // every reserved unit was paid out
    const after = await chain.client.bucket(b.address);
    expect(after.holdings.every((h) => h.reserved.toString() === '0')).toBe(true);
    await chain.send([await chain.client.closeRedeemOrderIx(order, done)], [backer]);
  });

  it('a stranger can neither redeem someone else’s tokens nor claim their slice', async () => {
    for (const s of ['NVDAx', 'AAPLx', 'pSPACEX', 'MSFTx']) await chain.setPrice(s, DESIGN_STOCKS.find((x) => x.symbol === s)!.price);
    const tokens = await invest(chain, backer, b, usd(100));
    const stranger = chain.user();
    const bucket = await chain.client.bucket(b.address);
    const { ix } = await chain.client.redeemIx({ holder: stranger.publicKey, payer: stranger.publicKey, bucketAddress: b.address, bucket, tokens });
    // swap the holder's ATA for the backer's
    const i = ix.keys.findIndex((k) => k.pubkey.equals(getAssociatedTokenAddressSync(bucket.tokenMint, stranger.publicKey)));
    ix.keys[i] = { ...ix.keys[i]!, pubkey: getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey) };
    expect(await chain.expectError([ix], [stranger], [b.table])).toBe('ConstraintTokenOwner');
    const order = await redeem(chain, backer, b, tokens);
    const o = await chain.client.redeemOrder(order);
    const claim = await chain.client.claimInKindIxs({ holder: stranger.publicKey, payer: stranger.publicKey, bucketAddress: b.address, bucket, orderAddress: order, order: o, leg: 0 });
    expect(await chain.expectError(claim, [stranger], [b.table])).toBe('ConstraintHasOne');
    await fillRedeem(chain, b, order);
  });
});
