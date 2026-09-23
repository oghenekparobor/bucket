// Phase 2 program items: propose_edit (24h notice, 7-day cooldown, creator
// pays new vault accounts), activate_edit (anyone, after notice), rebalance
// (keeper, toward target, within slippage), forced removal of a delisted token.
// Plus the price feed: bounded pushes, TWAP, admin override.

import { beforeAll, describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { Chain, DESIGN_STOCKS, usd } from './harness.js';
import { invest, publish, settle, snapshot, type Published } from './flows.js';

const DAY = 86_400;

describe('edits and rebalancing', () => {
  let chain: Chain;
  let creator: Keypair;
  let b: Published;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    await chain.faucet(creator.publicKey, usd(5_000));
    b = await publish(chain, creator, { name: 'Editable', holdings: [['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]] });
    await invest(chain, creator, b, usd(3_000));
  });

  const propose = async (holdings: [string, number][], note = 'Trimming SpaceX to fund Stripe.', who = creator) => {
    const bucket = await chain.client.bucket(b.address);
    return chain.client.proposeEditIxs({
      creator: who.publicKey,
      payer: who.publicKey,
      bucketAddress: b.address,
      bucket,
      holdings: holdings.map(([s, w]) => ({ mint: chain.stock(s).mint, weightBps: w * 100 })),
      note,
    });
  };
  const refreshPrices = async () => {
    for (const s of DESIGN_STOCKS) await chain.setPrice(s.symbol, s.price);
  };

  it('only the creator can propose, under the creation rules', async () => {
    const stranger = chain.user();
    const bucket = await chain.client.bucket(b.address);
    const ix = await chain.client.program.methods
      .proposeEdit([5_000, 5_000], 'x')
      .accountsPartial({ creator: stranger.publicKey, config: chain.client.pdas.config(), bucket: b.address })
      .remainingAccounts([chain.stock('NVDAx').mint, chain.stock('AAPLx').mint].map((m) => ({ pubkey: chain.client.pdas.asset(m), isSigner: false, isWritable: false })))
      .instruction();
    expect(await chain.expectError([ix], [stranger])).toBe('Unauthorized');
    expect(await chain.expectError(await propose([['NVDAx', 60], ['AAPLx', 40]]), [creator])).toBe('WeightTooHigh');
    expect(await chain.expectError(await propose([['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]], 'x'.repeat(141)), [creator])).toBe('NoteLength');
    expect(bucket.version).toBe(1);
  });

  it('a valid edit is pending for 24 hours, visible on-chain, and the creator pays the new vault account', async () => {
    const lamportsBefore = chain.svm.getBalance(creator.publicKey)!;
    await chain.send(await propose([['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 10], ['tSTRIPE', 15]]), [creator]);
    const bucket = await chain.client.bucket(b.address);
    expect(bucket.pending.map((p) => p.weightBps)).toEqual([4_000, 3_500, 1_000, 1_500]);
    expect(bucket.pendingNote).toBe('Trimming SpaceX to fund Stripe.');
    expect(Number(bucket.pendingEffectiveAt) - Number(chain.now())).toBe(DAY);
    // rent for the new tSTRIPE vault ATA came out of the creator's wallet
    expect(Number(lamportsBefore - chain.svm.getBalance(creator.publicKey)!)).toBeGreaterThan(2_000_000);
    const ev = chain.eventsNamed('EditProposed').at(-1)!.data as Record<string, unknown>;
    expect(ev.version).toBe(2);
    expect(ev.forced).toBe(false);
  });

  it('cannot activate early; anyone can activate after 24 hours', async () => {
    const bucket = await chain.client.bucket(b.address);
    const stranger = chain.user();
    expect(await chain.expectError([await chain.client.activateEditIx(b.address, bucket)], [stranger])).toBe('EditNotEffective');
    chain.advance(DAY);
    await chain.send([await chain.client.activateEditIx(b.address, bucket)], [stranger]);
    const after = await chain.client.bucket(b.address);
    expect(after.version).toBe(2);
    expect(after.pending).toHaveLength(0);
    expect(after.holdings.map((h) => h.weightBps)).toEqual([4_000, 3_500, 1_000, 1_500]);
  });

  it('one edit per 7 days', async () => {
    expect(await chain.expectError(await propose([['NVDAx', 50], ['AAPLx', 50]]), [creator])).toBe('EditCooldown');
  });

  it('keeper rebalances toward the new weights, one trade at a time, and unit price moves only by swap costs', async () => {
    await refreshPrices();
    b = { ...b, table: await chain.bucketTable(b.address, await chain.client.bucket(b.address)) };
    await settle(chain, b);
    const before = await snapshot(chain, b);
    const config = await chain.client.config();
    const sp = chain.stock('pSPACEX').mint;
    const st = chain.stock('tSTRIPE').mint;
    const spHolding = before.holdings.find((h) => h.mint === sp.toBase58())!;
    // sell the excess SpaceX (≈25% → 10%) into Stripe (0% → 15%), sized from live values
    const spValue = (spHolding.balance * spHolding.priceE6) / 10n ** 8n;
    const target = (before.value * 1_000n) / 10_000n;
    const excess = ((spHolding.balance * (spValue - target)) / spValue) * 99n / 100n;
    const r = await chain.client.rebalanceIx({ keeper: chain.keeper.publicKey, bucketAddress: b.address, bucket: before.bucket, config, fromMint: sp, toMint: st, qtyIn: excess, swap: chain.swap });
    await chain.send(r.ixs, [chain.keeper], [b.table]);
    const after = await snapshot(chain, b);
    expect(after.supply).toBe(before.supply);
    // two 1%/0.2% issuer fees and two 10 bps venue fees on 15% of the vault
    expect(after.unit).toBeLessThan(before.unit);
    expect(Number(before.unit - after.unit) / Number(before.unit)).toBeLessThan(0.004);
    const stHolding = after.holdings.find((h) => h.mint === st.toBase58())!;
    expect(stHolding.balance).toBeGreaterThan(0n);
    expect(chain.eventsNamed('Rebalanced')).toHaveLength(1);
  });

  it('rebalance refuses to trade away from target or beyond the excess', async () => {
    const s = await snapshot(chain, b);
    const config = await chain.client.config();
    // a trade may not push the buyer past its target either: the reverse trade is refused
    // Stripe is now roughly on target: selling it to buy SpaceX is the wrong direction
    const wrong = await chain.client.rebalanceIx({
      keeper: chain.keeper.publicKey, bucketAddress: b.address, bucket: s.bucket, config,
      fromMint: chain.stock('tSTRIPE').mint, toMint: chain.stock('pSPACEX').mint, qtyIn: 1_000n, swap: chain.swap,
    });
    expect(await chain.expectError(wrong.ixs, [chain.keeper], [b.table])).toBe('RebalanceDirection');
    const nv = s.holdings.find((h) => h.mint === chain.stock('NVDAx').mint.toBase58())!;
    const tooMuch = await chain.client.rebalanceIx({
      keeper: chain.keeper.publicKey, bucketAddress: b.address, bucket: s.bucket, config,
      fromMint: chain.stock('NVDAx').mint, toMint: chain.stock('AAPLx').mint, qtyIn: nv.balance / 2n, swap: chain.swap,
    });
    expect(await chain.expectError(tooMuch.ixs, [chain.keeper], [b.table])).toBe('RebalanceDirection');
  });

  it('rebalance needs a recent valuation', async () => {
    chain.advance(3_601);
    await refreshPrices();
    const s = await snapshot(chain, b);
    const config = await chain.client.config();
    const r = await chain.client.rebalanceIx({
      keeper: chain.keeper.publicKey, bucketAddress: b.address, bucket: s.bucket, config,
      fromMint: chain.stock('NVDAx').mint, toMint: chain.stock('AAPLx').mint, qtyIn: 1_000n, swap: chain.swap,
    });
    expect(await chain.expectError(r.ixs, [chain.keeper], [b.table])).toBe('StaleValuation');
  });

  it('a removed holding is sold down and then pruned', async () => {
    chain.advance(7 * DAY);
    await refreshPrices();
    await chain.send(await propose([['NVDAx', 50], ['AAPLx', 50]], 'Out of private names.'), [creator]);
    chain.advance(DAY);
    await refreshPrices();
    await chain.send([await chain.client.activateEditIx(b.address, await chain.client.bucket(b.address))], [creator]);
    let s = await snapshot(chain, b);
    expect(s.holdings.map((h) => h.weightBps)).toEqual([5_000, 5_000, 0, 0]);
    await settle(chain, b);
    const config = await chain.client.config();
    const total = BigInt((await chain.client.bucket(b.address)).lastValueE6.toString());
    const valueOf = (h: { balance: bigint; reserved: bigint; priceE6: bigint; decimals: number }) =>
      ((h.balance - h.reserved) * h.priceE6) / 10n ** BigInt(h.decimals);
    // sell each removed holding into whichever active holding is furthest below target, never past its target
    for (const sym of ['pSPACEX', 'tSTRIPE']) {
      for (let round = 0; round < 6; round++) {
        s = await snapshot(chain, b);
        const h = s.holdings.find((x) => x.mint === chain.stock(sym).mint.toBase58());
        if (!h || h.balance === 0n) break;
        const buyers = s.holdings
          .filter((x) => x.weightBps > 0)
          .map((x) => ({ x, shortfall: (total * BigInt(x.weightBps)) / 10_000n - valueOf(x) }))
          .sort((a, c) => (c.shortfall > a.shortfall ? 1 : -1));
        const buyer = buyers[0]!;
        const hv = valueOf(h);
        const qty = hv <= buyer.shortfall ? h.balance : (h.balance * buyer.shortfall * 999n) / (hv * 1_000n);
        const r = await chain.client.rebalanceIx({
          keeper: chain.keeper.publicKey, bucketAddress: b.address, bucket: s.bucket, config,
          fromMint: chain.stock(sym).mint, toMint: new PublicKey(buyer.x.mint), qtyIn: qty, swap: chain.swap,
        });
        await chain.send(r.ixs, [chain.keeper], [b.table]);
      }
    }
    s = await snapshot(chain, b);
    expect(s.holdings).toHaveLength(2);
    expect(s.bucket.version).toBe(3);
  });

  it('admin can force-remove a delisted token with the same 24h notice', async () => {
    const other = await publish(chain, creator, { name: 'Delisting', holdings: [['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]] });
    const mint = chain.stock('pSPACEX').mint;
    const acct = await chain.client.bucket(other.address);
    const ix = chain.client.adminProposeRemovalIx(chain.admin.publicKey, other.address, acct, mint);
    expect(await chain.expectError([await chain.client.adminProposeRemovalIx(creator.publicKey, other.address, acct, mint)], [creator])).toBe('Unauthorized');
    await chain.send([await ix], [chain.admin]);
    const bucket = await chain.client.bucket(other.address);
    // 40/35 renormalizes to 53/47, then NVDAx is clamped to the 50% cap and the overflow moves to AAPLx
    expect(bucket.pending.map((p) => p.weightBps)).toEqual([5_000, 5_000]);
    expect(Number(bucket.pendingEffectiveAt) - Number(chain.now())).toBe(DAY);
    const ev = chain.eventsNamed('EditProposed').at(-1)!.data as Record<string, unknown>;
    expect(ev.forced).toBe(true);
  });

  it('forced removal refuses a result that breaks the rules (too few holdings or caps unreachable)', async () => {
    const two = await publish(chain, creator, { name: 'Two', holdings: [['NVDAx', 50], ['MSFTx', 50]] });
    const acct = await chain.client.bucket(two.address);
    const ix = await chain.client.adminProposeRemovalIx(chain.admin.publicKey, two.address, acct, chain.stock('MSFTx').mint);
    expect(await chain.expectError([ix], [chain.admin])).toBe('HoldingCount');
    const pre = await publish(chain, creator, { name: 'Mostly private', holdings: [['pSPACEX', 25], ['tSTRIPE', 25], ['NVDAx', 50]] });
    const pacct = await chain.client.bucket(pre.address);
    // dropping NVDAx leaves two pre-IPO tokens capped at 25% each: 100% is unreachable
    const pix = await chain.client.adminProposeRemovalIx(chain.admin.publicKey, pre.address, pacct, chain.stock('NVDAx').mint);
    expect(await chain.expectError([pix], [chain.admin])).toBe('WeightTooHigh');
  });
});

describe('price feed', () => {
  let chain: Chain;
  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
  });

  it('only the price authority pushes; pushes are clamped to 20% of the TWAP', async () => {
    const mint = chain.stock('NVDAx').mint;
    const stranger = chain.user();
    expect(await chain.expectError([await chain.client.updatePriceIx(stranger.publicKey, mint, usd(200))], [stranger])).toBe('Unauthorized');
    await chain.send([await chain.client.updatePriceIx(chain.priceAuthority.publicKey, mint, usd(1_000))], [chain.priceAuthority]);
    const ev = chain.eventsNamed('PriceUpdated').at(-1)!.data as Record<string, unknown>;
    expect(ev.clamped).toBe(true);
    const a = await chain.client.asset(mint);
    expect(BigInt(a.priceE6.toString())).toBe((usd(184.2) * 12_000n) / 10_000n);
  });

  it('the TWAP follows over its window, and commission uses the lower of spot and TWAP', async () => {
    const mint = chain.stock('AAPLx').mint;
    await chain.send([await chain.client.updatePriceIx(chain.priceAuthority.publicKey, mint, usd(300))], [chain.priceAuthority]);
    const a = await chain.client.asset(mint);
    // no time passed since listing: TWAP has not moved yet
    expect(BigInt(a.twapE6.toString())).toBe(usd(258.4));
    chain.advance(900);
    await chain.send([await chain.client.updatePriceIx(chain.priceAuthority.publicKey, mint, usd(300))], [chain.priceAuthority]);
    const a2 = await chain.client.asset(mint);
    expect(BigInt(a2.twapE6.toString())).toBe(usd(258.4) + (usd(300) - usd(258.4)) / 2n);
  });

  it('a one-push spike pays no commission; a rise that holds through the TWAP window pays in full', async () => {
    const { invest, publish, settle, snapshot } = await import('./flows.js');
    const creator = chain.user();
    await chain.faucet(creator.publicKey, usd(1_000));
    for (const s of ['NVDAx', 'MSFTx']) await chain.setPrice(s, DESIGN_STOCKS.find((x) => x.symbol === s)!.price, { force: true });
    const b = await publish(chain, creator, { name: 'Spike', holdings: [['NVDAx', 50], ['MSFTx', 50]] });
    await invest(chain, creator, b, usd(1_000));
    const settledCount = () => chain.eventsNamed('CommissionSettled').filter((e) => e.data.bucket === b.address.toBase58()).length;

    // +15% in one push: spot moves, the TWAP has not, so no commission
    for (const s of ['NVDAx', 'MSFTx']) await chain.setPrice(s, DESIGN_STOCKS.find((x) => x.symbol === s)!.price * 1.15);
    await settle(chain, b);
    expect(settledCount()).toBe(0);
    expect((await snapshot(chain, b)).unit).toBeGreaterThan(usd(114));

    // the price holds: pushes every 10 minutes for an hour
    for (let i = 0; i < 6; i++) {
      chain.advance(600);
      for (const s of ['NVDAx', 'MSFTx']) await chain.setPrice(s, DESIGN_STOCKS.find((x) => x.symbol === s)!.price * 1.15);
    }
    await settle(chain, b);
    expect(settledCount()).toBe(1);
    const ev = chain.eventsNamed('CommissionSettled').at(-1)!.data as Record<string, string>;
    // 20% of a ~$14.8 rise on ~9.95 tokens ≈ $29
    expect(Number(ev.commission_e6) / 1e6).toBeGreaterThan(25);
    expect(Number(ev.commission_e6) / 1e6).toBeLessThan(31);
  });

  it('only admin can force a price (corporate actions), which resets the TWAP', async () => {
    const mint = chain.stock('SPYx').mint;
    expect(await chain.expectError([await chain.client.updatePriceIx(chain.priceAuthority.publicKey, mint, usd(66.42), true)], [chain.priceAuthority])).toBe('Unauthorized');
    await chain.send([await chain.client.updatePriceIx(chain.admin.publicKey, mint, usd(66.42), true)], [chain.admin]);
    const a = await chain.client.asset(mint);
    expect(BigInt(a.twapE6.toString())).toBe(usd(66.42));
  });
});

describe('a full 15-for-15 replacement edit', () => {
  it('fits: 15 old holdings wind down while 15 new ones start', async () => {
    const specs = Array.from({ length: 30 }, (_, i) => ({ symbol: `R${i}`, price: 10 + i, source: 'xStocks' as const, kind: 'publicStock' as const }));
    const chain = await Chain.boot(specs);
    const creator = chain.user();
    const w = [8, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5];
    const { publish } = await import('./flows.js');
    const b = await publish(chain, creator, { name: 'Replace all', holdings: specs.slice(0, 15).map((s, i) => [s.symbol, w[i]!]) });
    const bucket = await chain.client.bucket(b.address);
    const ixs = await chain.client.proposeEditIxs({
      creator: creator.publicKey,
      payer: creator.publicKey,
      bucketAddress: b.address,
      bucket,
      holdings: specs.slice(15).map((s, i) => ({ mint: chain.stock(s.symbol).mint, weightBps: w[i]! * 100 })),
      note: 'New thesis entirely.',
    });
    for (let i = 0; i < ixs.length - 1; i += 5) await chain.send(ixs.slice(i, Math.min(i + 5, ixs.length - 1)), [creator]);
    await chain.send([ixs.at(-1)!], [creator]);
    chain.advance(DAY);
    const pending = await chain.client.bucket(b.address);
    await chain.send([await chain.client.activateEditIx(b.address, pending)], [creator], [b.table, chain.setLookupTable(pending.pending.map((p) => p.vault))]);
    const after = await chain.client.bucket(b.address);
    expect(after.holdings).toHaveLength(30);
    expect(after.holdings.filter((h) => h.weightBps > 0)).toHaveLength(15);
  });
});
