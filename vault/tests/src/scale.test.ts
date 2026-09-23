// Spike 0.3: a proportional mint into a 15-holding vault. How many
// transactions does it take, what does each cost, and what does a failed leg
// look like? Results are printed and written to docs/spikes/fifteen-holding-mint.json.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AddressLookupTableAccount } from '@solana/web3.js';

import { Chain, usd, type StockSpec } from './harness.js';
import { closeMint, fillRedeem, invest, openMint, publish, redeem } from './flows.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('15-holding vault', () => {
  it('measures transactions and compute per mint and redeem', async () => {
    const specs: StockSpec[] = Array.from({ length: 15 }, (_, i) => ({
      symbol: `T${i}`,
      price: 20 + i * 37.5,
      source: i < 12 ? 'xStocks' : i < 14 ? 'preStocks' : 'tessera',
      kind: i < 12 ? 'publicStock' : 'preIpo',
      transferFeeBps: i >= 12 && i < 14 ? 100 : i === 14 ? 20 : 0,
    }));
    const chain = await Chain.boot(specs);
    const creator = chain.user();
    const backer = chain.user();
    await chain.faucet(creator.publicKey, usd(5_000));
    await chain.faucet(backer.publicKey, usd(5_000));
    const weights = [8, 8, 8, 8, 8, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5];
    expect(weights.reduce((a, b) => a + b)).toBe(100);
    const b = await publish(chain, creator, { name: 'Fifteen', holdings: specs.map((s, i) => [s.symbol, weights[i]!]) });

    const report: Record<string, unknown> = { holdings: 15 };
    const altSize = chain.client.lookupTableAddresses(b.address, b.bucket, await chain.client.config()).length;
    report.publish = {
      vaultAtaTxs: 3,
      createBucketTxs: 1,
      lookupTableTxs: 1 + Math.ceil(altSize / 30),
      lookupTableAddresses: altSize,
    };

    await invest(chain, creator, b, usd(1_000));

    // open_mint: one transaction with the bucket's lookup table
    const order = await openMint(chain, backer, b, usd(1_500));
    report.openMint = { txs: 1, computeUnits: Number(chain.lastCu) };

    // fills: pack as many legs per transaction as fit (size and compute)
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    let o = await chain.client.mintOrder(order);
    const perLegCu: number[] = [];
    const fills: { legs: number; cu: number }[] = [];
    // add the mock venue's per-stock accounts to a second table, as the keeper would
    const venueTable = chain.setLookupTable([
      chain.swap.pdas.state(),
      chain.swap.pdas.mintAuthority(),
      ...specs.flatMap((s) => {
        const st = chain.stock(s.symbol);
        return [chain.swap.pdas.market(st.mint), chain.swap.pdas.inventory(st.mint, st.tokenProgram)];
      }),
      chain.client.pdas.escrow(order, config.usdcMint),
      order,
    ]);
    const tables: AddressLookupTableAccount[] = [b.table, venueTable];
    let leg = 0;
    while (leg < o.legs.length) {
      let packed = 0;
      let ok = false;
      for (let n = 8; n >= 1 && !ok; n--) {
        const ixs = [];
        for (let k = 0; k < n && leg + k < o.legs.length; k++) {
          const f = await chain.client.fillMintIx({ signer: chain.keeper.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: leg + k, swap: chain.swap });
          ixs.push(...f.ixs);
        }
        try {
          const res = chain.trySendSync(ixs, [chain.keeper], tables);
          if (!('err' in res)) {
            ok = true;
            packed = ixs.length;
            fills.push({ legs: packed, cu: Number(chain.lastCu) });
          }
        } catch {
          // transaction too large to encode: try fewer legs
        }
      }
      if (!ok) throw new Error(`could not fill leg ${leg}`);
      if (packed === 1) perLegCu.push(fills.at(-1)!.cu);
      leg += packed;
      o = await chain.client.mintOrder(order);
    }
    await closeMint(chain, order);
    report.fillMint = { txs: fills.length, legsPerTx: fills.map((f) => f.legs), computeUnitsPerTx: fills.map((f) => f.cu) };
    report.mintTotalTxs = 1 + fills.length + 1;

    // a single-leg fill in isolation
    const order2 = await openMint(chain, backer, b, usd(100));
    const o2 = await chain.client.mintOrder(order2);
    const single = await chain.client.fillMintIx({ signer: chain.keeper.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order2, order: o2, leg: 0, swap: chain.swap });
    await chain.send(single.ixs, [chain.keeper], [b.table]);
    report.fillMintSingleLegCu = Number(chain.lastCu);
    // failed leg: the venue moves 5% away — the transaction fails whole, nothing moves, the budget is refundable
    await chain.setPrice('T1', (20 + 37.5) * 1.05, { marketOnly: true });
    const failing = await chain.client.fillMintIx({ signer: chain.keeper.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order2, order: await chain.client.mintOrder(order2), leg: 1, swap: chain.swap });
    report.failedLeg = { error: await chain.expectError(failing.ixs, [chain.keeper], [b.table]), effect: 'tx reverts; leg budget stays in escrow; keeper or backer closes the order to refund it' };
    await closeMint(chain, order2);

    // redeem: one transaction, then one sell per leg (or in-kind claims)
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey));
    await chain.setPrice('T1', 20 + 37.5, { marketOnly: true });
    const rOrder = await redeem(chain, backer, b, held);
    report.redeem = { txs: 1, computeUnits: Number(chain.lastCu) };
    const before = chain.events.length;
    await fillRedeem(chain, b, rOrder);
    report.fillRedeem = { txs: chain.events.length - before, computeUnitsLastTx: Number(chain.lastCu) };

    console.log('15-holding spike', JSON.stringify(report, null, 2));
    writeFileSync(join(here, '..', '..', '..', 'docs', 'spikes', 'fifteen-holding-mint.json'), JSON.stringify(report, null, 2) + '\n');
    expect((report.openMint as { computeUnits: number }).computeUnits).toBeLessThan(400_000);
    expect(fills.length).toBeLessThanOrEqual(15);
    expect(perLegCu.every((c) => c < 200_000)).toBe(true);
  });
});
