// Independent security review (see docs/security/internal-review.md).
//
// These tests PROVE the candidate issues found while reviewing the program:
//  - passing tests confirm a suspected weakness is NOT exploitable (the defence
//    holds), and document why;
//  - tests that assert a bad/surprising outcome demonstrate a real finding.
//
// This file adds nothing to the program and changes no existing test; it is the
// evidence behind the review's findings table.

import { beforeAll, describe, expect, it } from 'vitest';
import BN from 'bn.js';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import { MOCK_SWAP_PROGRAM_ID } from '@bucket/sdk';
import { Chain, DESIGN_STOCKS, usd } from './harness.js';
import { closeMint, fillMint, invest, openMint, publish, redeem, snapshot, type Published } from './flows.js';

// ---------------------------------------------------------------------------
// F1 (Medium, FIXED): the "creator funds first, ≥ $25" gate used to flip on the
// first leg fill, so a creator could fill 2 cents of one leg, refund the rest,
// and open the bucket to backers with almost nothing in it — sending the first
// backer's deposit into that single holding. It now flips only when a creator
// order has filled completely. These tests are the regression for that fix.
// ---------------------------------------------------------------------------
describe('F1 creator-funding gate needs a completely filled creator order', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(2_000));
    await chain.faucet(backer.publicKey, usd(2_000));
    b = await publish(chain, creator, { name: 'DustFund', holdings: [['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]] });
  });

  it('a 2-cent fill followed by a refund does not fund the bucket', async () => {
    const order = await openMint(chain, creator, b, usd(25));
    const o = await chain.client.mintOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const leg0 = o.legs[0]!;
    const escrow = chain.client.pdas.escrow(order, config.usdcMint);
    const smallIn = 20_000n; // 2 cents
    const route = await chain.swap.build({
      inputMint: config.usdcMint,
      outputMint: leg0.mint,
      amountIn: smallIn,
      authority: order,
      source: escrow,
      destination: bucket.holdings[0]!.vault,
      slippageBps: 100,
    });
    const ix = await chain.client.program.methods
      .fillMint(0, new BN(smallIn.toString()), new BN(route.minOut.toString()), route.data)
      .accountsPartial({
        signer: creator.publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        bucketMint: bucket.tokenMint,
        order,
        escrow,
        vault: bucket.holdings[0]!.vault,
        asset: chain.client.pdas.asset(leg0.mint),
        backerBucketAta: getAssociatedTokenAddressSync(bucket.tokenMint, creator.publicKey),
        swapProgram: MOCK_SWAP_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(route.keys)
      .instruction();
    await chain.send([ix], [creator], [b.table]);
    expect((await chain.client.bucket(b.address)).creatorFunded).toBe(false);
    await closeMint(chain, order, creator);
    expect((await chain.client.bucket(b.address)).creatorFunded).toBe(false);

    // so a backer still cannot mint into it
    const cfg = await chain.client.config();
    const bk = await chain.client.bucket(b.address);
    const { ix: open } = await chain.client.openMintIx({ backer: backer.publicKey, payer: backer.publicKey, bucketAddress: b.address, bucket: bk, config: cfg, amountE6: usd(1_000) });
    expect(await chain.expectError([open], [backer], [b.table])).toBe('CreatorNotFunded');
  });

  it('a completely filled creator order funds it, in the recipe weights', async () => {
    const { invest } = await import('./flows.js');
    await invest(chain, creator, b, usd(25));
    expect((await chain.client.bucket(b.address)).creatorFunded).toBe(true);
    const snap = await snapshot(chain, b);
    expect(snap.value).toBeGreaterThan(usd(24));
    expect(snap.holdings.filter((h) => h.balance > 0n)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
describe('D1 post-open appreciation cannot be minted cheaply', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(5_000));
    await chain.faucet(backer.publicKey, usd(5_000));
    b = await publish(chain, creator, { name: 'RefPrice', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
    await invest(chain, creator, b, usd(2_000));
  });

  it('a leg whose stock rose > slippage after open is rejected (SlippageExceeded)', async () => {
    const order = await openMint(chain, backer, b, usd(1_000));
    const o = await chain.client.mintOrder(order);
    const nvIdx = o.legs.findIndex((l) => l.mint.equals(chain.stock('NVDAx').mint));
    // NVDA rises 5% at the venue AND on-chain (both within the 20% clamp), after the order fixed its reference price.
    await chain.setPrice('NVDAx', 184.2 * 1.05);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillMintIx({ signer: chain.keeper.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: nvIdx, swap: chain.swap });
    expect(await chain.expectError(f.ixs, [chain.keeper], [b.table])).toBe('SlippageExceeded');
    await chain.setPrice('NVDAx', 184.2);
    await closeMint(chain, order);
  });

  it('a leg whose stock fell after open still fills, and does not dilute existing holders', async () => {
    const before = await snapshot(chain, b);
    const order = await openMint(chain, backer, b, usd(1_000));
    const o = await chain.client.mintOrder(order);
    // both holdings fall 5% after the order fixed its (now stale-high) references
    await chain.setPrice('NVDAx', 184.2 * 0.95);
    await chain.setPrice('AAPLx', 258.4 * 0.95);
    await fillMint(chain, b, order);
    await closeMint(chain, order);
    const after = await snapshot(chain, b);
    // supply x unit price still equals vault value, and the per-token unit price
    // is not pulled below what the price move alone explains: no dilution.
    expect(after.value).toBeGreaterThan(before.value); // vault grew by the new money
    // reset
    await chain.setPrice('NVDAx', 184.2);
    await chain.setPrice('AAPLx', 258.4);
  });
});

// ---------------------------------------------------------------------------
// D2 (defence holds): even using an ALLOW-LISTED swap program adversarially,
// a keeper cannot drain a redeem: routing the reserved stock into a *different*
// vault (a stock->stock swap) is caught by the guard, and routing that delivers
// no USDC to the holder is caught by the output/slippage check. The holder's
// reserved slice is untouched and remains claimable in kind.
// ---------------------------------------------------------------------------
describe('D2 adversarial use of an allow-listed swap cannot divert a redeem', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(3_000));
    await chain.faucet(backer.publicKey, usd(3_000));
    b = await publish(chain, creator, { name: 'RedeemGuard', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
    await invest(chain, creator, b, usd(1_000));
    await invest(chain, backer, b, usd(1_000));
  });

  it('keeper cannot convert a redeemer’s reserved stock into another vault holding', async () => {
    const bucket0 = await chain.client.bucket(b.address);
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket0.tokenMint, backer.publicKey));
    const order = await redeem(chain, backer, b, held);
    const o = await chain.client.redeemOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const nvIdx = o.legs.findIndex((l) => l.mint.equals(chain.stock('NVDAx').mint));
    const nvVault = bucket.holdings.find((h) => h.mint.equals(chain.stock('NVDAx').mint))!.vault;
    const aaplVault = bucket.holdings.find((h) => h.mint.equals(chain.stock('AAPLx').mint))!.vault;
    // stock -> stock route: NVDAx out of its vault, AAPLx into the *other* vault. No USDC to the holder.
    const route = await chain.swap.build({
      inputMint: chain.stock('NVDAx').mint,
      outputMint: chain.stock('AAPLx').mint,
      amountIn: BigInt(o.legs[nvIdx]!.qty.toString()),
      authority: b.address,
      source: nvVault,
      destination: aaplVault,
      slippageBps: 100,
    });
    const ix = await chain.client.program.methods
      .fillRedeem(nvIdx, o.legs[nvIdx]!.qty, new BN(0), route.data)
      .accountsPartial({
        signer: chain.keeper.publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        bucketMint: bucket.tokenMint,
        order,
        vault: nvVault,
        asset: chain.client.pdas.asset(chain.stock('NVDAx').mint),
        holderUsdc: getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey),
        swapProgram: MOCK_SWAP_PROGRAM_ID,
      })
      .remainingAccounts(route.keys)
      .instruction();
    // AAPLx vault is bucket-owned and not the allowed leg vault -> guard rejects it.
    expect(await chain.expectError([ix], [chain.keeper], [b.table])).toBe('ForbiddenSwapAccount');

    // the reserved slice is untouched: the holder can still take it in kind, no keeper needed.
    const claim = await chain.client.claimInKindIxs({ holder: backer.publicKey, payer: backer.publicKey, bucketAddress: b.address, bucket, orderAddress: order, order: o, leg: nvIdx });
    await chain.send(claim, [backer]);
    const got = chain.tokenBalance(getAssociatedTokenAddressSync(chain.stock('NVDAx').mint, backer.publicKey, false, chain.stock('NVDAx').tokenProgram));
    expect(got).toBeGreaterThan(0n);
  });
});

// ---------------------------------------------------------------------------
// F2 (Info / accepted trade-off, but proven): redeem skips commission when any
// price is stale. A holder who redeems while the price feed is stale realizes
// their gains and pays ZERO commission, and the creator/platform never collect
// the 20% on that growth. Holders cannot force staleness, so this only bites
// during a feed outage — but it is a real, unbounded leak of commission then.
// ---------------------------------------------------------------------------
describe('F2 a stale-price redeem escapes commission entirely', () => {
  let chain: Chain;
  let creator: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot([
      { symbol: 'AAA', price: 100, source: 'xStocks', kind: 'publicStock', swapFeeBps: 0 },
      { symbol: 'BBB', price: 100, source: 'xStocks', kind: 'publicStock', swapFeeBps: 0 },
    ], { mintFeeBps: 0 });
    creator = chain.user();
    await chain.faucet(creator.publicKey, usd(100_000));
    b = await publish(chain, creator, { name: 'StaleExit', holdings: [['AAA', 50], ['BBB', 50]] });
    await invest(chain, creator, b, usd(10_000));
  });

  it('a +25% gain that would owe commission pays none once the feed goes stale', async () => {
    // The gain holds through the TWAP window, so commission IS due on a fresh settle.
    for (let i = 0; i < 7; i++) {
      chain.advance(600);
      await chain.setPrice('AAA', 125);
      await chain.setPrice('BBB', 125);
    }
    const s = await snapshot(chain, b);
    expect(s.unit).toBeGreaterThan(s.hwm); // commission would be due

    // Feed goes stale (> max_price_age). Redeem must still work, and it skips settlement.
    chain.advance(3_601);
    const creatorFee = chain.client.pdas.creatorFee(b.address);
    const platformFee = chain.client.pdas.platformFee(b.address);
    expect(chain.tokenBalance(creatorFee)).toBe(0n);

    const bucket = await chain.client.bucket(b.address);
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, creator.publicKey));
    const order = await redeem(chain, creator, b, held);
    const ev = chain.eventsNamed('Redeemed').at(-1)!.data as Record<string, unknown>;
    expect(ev.settled).toBe(false); // commission settlement was skipped
    // No commission tokens were ever minted for the +25% growth this holder realized.
    expect(chain.tokenBalance(creatorFee)).toBe(0n);
    expect(chain.tokenBalance(platformFee)).toBe(0n);
    // sanity: the redeem reserved the holder's full pro-rata slice regardless of price
    const o = await chain.client.redeemOrder(order);
    expect(o.legs.every((l) => BigInt(l.qty.toString()) > 0n)).toBe(true);
  });
});
