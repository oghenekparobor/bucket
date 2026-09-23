// Recipe rules, minimums and bucket status, as enforced on-chain.

import { beforeAll, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';

import { Chain, DESIGN_STOCKS, usd } from './harness.js';
import { invest, publish, redeem, fillRedeem, type Published } from './flows.js';

const STOCKS = [
  ...DESIGN_STOCKS,
  { symbol: 'GOOGLx', price: 246.1, source: 'xStocks' as const, kind: 'publicStock' as const },
  { symbol: 'AMZNx', price: 231.7, source: 'xStocks' as const, kind: 'publicStock' as const },
];

describe('create_bucket rules', () => {
  let chain: Chain;
  let creator: Keypair;

  beforeAll(async () => {
    chain = await Chain.boot(STOCKS);
    creator = chain.user();
  });

  const tryCreate = async (holdings: [string, number][], name = 'Test', thesis = '', who = creator) => {
    const flow = await chain.client.createBucketFlow({
      creator: who.publicKey,
      payer: who.publicKey,
      name,
      thesis,
      holdings: holdings.map(([s, w]) => ({ mint: chain.stock(s).mint, weightBps: w })),
    });
    return chain.expectError([flow.createIx], [who]);
  };

  it('needs at least 2 holdings', async () => {
    expect(await tryCreate([['NVDAx', 10_000]])).toBe('HoldingCount');
  });

  it('weights must sum to 100%', async () => {
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 4_000]])).toBe('WeightSum');
  });

  it('weights are whole percentages', async () => {
    expect(await tryCreate([['NVDAx', 5_050], ['MSFTx', 4_950]])).toBe('WeightNotWholePercent');
  });

  it('each weight is at least 2%', async () => {
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 4_900], ['AAPLx', 100]])).toBe('WeightTooLow');
  });

  it('a public stock is capped at 50%', async () => {
    expect(await tryCreate([['NVDAx', 6_000], ['MSFTx', 4_000]])).toBe('WeightTooHigh');
  });

  it('a pre-IPO token is capped at 25%', async () => {
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 2_000], ['pSPACEX', 3_000]])).toBe('WeightTooHigh');
  });

  it('rejects a duplicate token', async () => {
    expect(await tryCreate([['NVDAx', 5_000], ['NVDAx', 5_000]])).toBe('DuplicateHolding');
  });

  it('rejects a token disabled in the catalog', async () => {
    await chain.send(
      [await chain.client.setAssetStatusIx({ admin: chain.admin.publicKey, mint: chain.stock('AMZNx').mint, enabled: true, flagged: true, extraCostBps: 0 })],
      [chain.admin],
    );
    expect(await tryCreate([['NVDAx', 5_000], ['AMZNx', 5_000]])).toBe('AssetNotAllowed');
  });

  it('rejects a mint that is not in the catalog at all', async () => {
    const stray = chain.createMint(8, chain.admin.publicKey, (await import('@solana/spl-token')).TOKEN_2022_PROGRAM_ID);
    const flow = await chain.client.createBucketFlow({
      creator: creator.publicKey,
      payer: creator.publicKey,
      name: 'Stray',
      thesis: '',
      holdings: [{ mint: chain.stock('NVDAx').mint, weightBps: 5_000 }, { mint: chain.stock('MSFTx').mint, weightBps: 5_000 }],
    }).catch(() => null);
    expect(flow).not.toBeNull();
    // swap the second asset account for the stray mint's (non-existent) asset PDA
    const ix = flow!.createIx;
    ix.keys[ix.keys.length - 1] = { pubkey: chain.client.pdas.asset(stray), isSigner: false, isWritable: false };
    expect(await chain.expectError([ix], [creator])).toBe('AccountNotInitialized');
  });

  it('name must be non-empty and short; thesis at most 280 bytes', async () => {
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 5_000]], '   ')).toBe('NameLength');
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 5_000]], 'x'.repeat(49))).toBe('NameLength');
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 5_000]], 'ok', 'x'.repeat(281))).toBe('ThesisLength');
  });

  it('allows 15 holdings but not 16', async () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ symbol: `S${i}`, price: 10 + i, source: 'xStocks' as const, kind: 'publicStock' as const }));
    for (const s of many) await chain.addStock(s);
    const weights15 = many.slice(0, 15).map((s, i) => [s.symbol, i < 10 ? 700 : 600] as [string, number]);
    expect(weights15.reduce((a, [, w]) => a + w, 0)).toBe(10_000);
    const b = await publish(chain, chain.user(), { name: 'Fifteen', holdings: weights15.map(([s, w]) => [s, w / 100]) });
    expect(b.bucket.holdings).toHaveLength(15);
    const w16 = many.map((s, i) => [s.symbol, i < 4 ? 700 : 600] as [string, number]);
    expect(await tryCreate(w16)).toBe('HoldingCount');
  });

  it('a wallet can have at most 5 active buckets', async () => {
    const who = chain.user();
    for (let i = 0; i < 5; i++) await publish(chain, who, { name: `B${i}`, holdings: [['NVDAx', 50], ['MSFTx', 50]] });
    expect(await tryCreate([['NVDAx', 5_000], ['MSFTx', 5_000]], 'B5', '', who)).toBe('TooManyBuckets');
    // closing one frees a slot
    const first = chain.client.pdas.bucket(who.publicKey, 0);
    await chain.send([await chain.client.closeBucketIx(who.publicKey, first)], [who]);
    await publish(chain, who, { name: 'B5', holdings: [['NVDAx', 50], ['MSFTx', 50]] });
  });
});

describe('minimums and status', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(1_000));
    await chain.faucet(backer.publicKey, usd(1_000));
    b = await publish(chain, creator, { name: 'Mins', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
  });

  const tryOpen = async (who: Keypair, amount: bigint) => {
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const { ix } = await chain.client.openMintIx({ backer: who.publicKey, payer: who.publicKey, bucketAddress: b.address, bucket, config, amountE6: amount });
    return chain.expectError([ix], [who], [b.table]);
  };

  it('nobody but the creator can mint before the creator funds it', async () => {
    expect(await tryOpen(backer, usd(100))).toBe('CreatorNotFunded');
  });

  it("the creator's first mint must be at least $25", async () => {
    expect(await tryOpen(creator, usd(24.99))).toBe('BelowMinimum');
    await invest(chain, creator, b, usd(25));
  });

  it('everyone else needs at least $1', async () => {
    expect(await tryOpen(backer, usd(0.99))).toBe('BelowMinimum');
    const t = await invest(chain, backer, b, usd(1));
    expect(t).toBeGreaterThan(0n);
  });

  it('charges the 0.20% mint fee to the platform fee wallet', async () => {
    const before = chain.usdcOf(chain.feeWallet.publicKey);
    await invest(chain, backer, b, usd(500));
    expect(chain.usdcOf(chain.feeWallet.publicKey) - before).toBe(usd(1));
  });

  it('a sponsor that fronted account rent recovers it in USDC, capped at $1, never from a self-paid mint', async () => {
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const sponsor = chain.user();
    const newcomer = chain.user();
    await chain.faucet(newcomer.publicKey, usd(50));
    const build = (payer: Keypair, rentFeeE6: bigint) =>
      chain.client.openMintIx({ backer: newcomer.publicKey, payer: payer.publicKey, bucketAddress: b.address, bucket, config, amountE6: usd(10), rentFeeE6 });
    expect(await chain.expectError([(await build(sponsor, usd(1.01))).ix], [sponsor, newcomer], [b.table])).toBe('InvalidParam');
    expect(await chain.expectError([(await build(newcomer, usd(0.42))).ix], [newcomer], [b.table])).toBe('InvalidParam');
    const feeBefore = chain.usdcOf(chain.feeWallet.publicKey);
    const { ix, order } = await build(sponsor, usd(0.42));
    await chain.send([ix], [sponsor, newcomer], [b.table]);
    // 0.20% of $10 plus the $0.42 rent
    expect(chain.usdcOf(chain.feeWallet.publicKey) - feeBefore).toBe(usd(0.02) + usd(0.42));
    expect(chain.usdcOf(newcomer.publicKey)).toBe(usd(50) - usd(10) - usd(0.42));
    const ev = chain.eventsNamed('MintOpened').at(-1)!.data as Record<string, string>;
    expect(ev.rent_fee_e6).toBe('420000');
    const { fillMint, closeMint } = await import('./flows.js');
    await fillMint(chain, b, order);
    await closeMint(chain, order);
  });

  it('closing blocks new mints but redeem stays open', async () => {
    await chain.send([await chain.client.closeBucketIx(creator.publicKey, b.address)], [creator]);
    expect(await tryOpen(backer, usd(10))).toBe('BucketClosed');
    const bucket = await chain.client.bucket(b.address);
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey));
    const order = await redeem(chain, backer, b, held);
    await fillRedeem(chain, b, order);
    expect(chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey))).toBe(0n);
  });

  it('name and thesis are editable by the creator only', async () => {
    await chain.send([await chain.client.updateBucketInfoIx(creator.publicKey, b.address, 'Mins v2', 'New thesis.')], [creator]);
    const bucket = await chain.client.bucket(b.address);
    expect(bucket.name).toBe('Mins v2');
    expect(bucket.thesis).toBe('New thesis.');
    const stranger = chain.user();
    expect(await chain.expectError([await chain.client.updateBucketInfoIx(stranger.publicKey, b.address, 'x', '')], [stranger])).toBe('Unauthorized');
    expect(await chain.expectError([await chain.client.updateBucketInfoIx(creator.publicKey, b.address, '', '')], [creator])).toBe('NameLength');
  });

  it('only the creator can close, and only once', async () => {
    const other = await publish(chain, creator, { name: 'Other', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
    const attacker = chain.user();
    const ix = await chain.client.program.methods
      .closeBucket()
      .accountsPartial({ creator: attacker.publicKey, bucket: other.address, creatorState: chain.client.pdas.creatorState(attacker.publicKey) })
      .instruction();
    expect(await chain.expectError([ix], [attacker])).toMatch(/Unauthorized|AccountNotInitialized/);
    expect(await chain.expectError([await chain.client.closeBucketIx(creator.publicKey, b.address)], [creator])).toBe('BucketClosed');
  });

  it('pausing mints never pauses redeem', async () => {
    const live = await publish(chain, creator, { name: 'Live', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
    await invest(chain, creator, live, usd(100));
    const { defaultConfigParams } = await import('@bucket/sdk');
    await chain.send([await chain.client.updateConfigIx(chain.admin.publicKey, defaultConfigParams({ mintsPaused: true }))], [chain.admin]);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(live.address);
    const { ix } = await chain.client.openMintIx({ backer: creator.publicKey, payer: creator.publicKey, bucketAddress: live.address, bucket, config, amountE6: usd(10) });
    expect(await chain.expectError([ix], [creator], [live.table])).toBe('MintsPaused');
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, creator.publicKey));
    const order = await redeem(chain, creator, live, held / 2n);
    await fillRedeem(chain, live, order);
    await chain.send([await chain.client.updateConfigIx(chain.admin.publicKey, defaultConfigParams())], [chain.admin]);
  });

  it('enforces the vault cap on mints', async () => {
    const capped = await publish(chain, creator, { name: 'Capped', holdings: [['NVDAx', 50], ['AAPLx', 50]] });
    const { defaultConfigParams } = await import('@bucket/sdk');
    await chain.send([await chain.client.updateConfigIx(chain.admin.publicKey, defaultConfigParams({ vaultCapE6: usd(200) }))], [chain.admin]);
    await invest(chain, creator, capped, usd(150));
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(capped.address);
    const { ix } = await chain.client.openMintIx({ backer: creator.publicKey, payer: creator.publicKey, bucketAddress: capped.address, bucket, config, amountE6: usd(100) });
    expect(await chain.expectError([ix], [creator], [capped.table])).toBe('VaultCap');
    await chain.send([await chain.client.updateConfigIx(chain.admin.publicKey, defaultConfigParams())], [chain.admin]);
  });
});
