/**
 * Deterministic program simulator for fixtures: plays the design's buckets forward in time and emits
 * the exact events bucket_vault would (docs/architecture.md §2.3), using the same pure math as the
 * indexer (settle before every mint and redeem, daily settlements, proportional mints and redeems,
 * edits with a 24h delay and a rebalance). Everything it produces is marked `fixture`.
 */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { RawEvent, EventName } from '../indexer/events.js';
import { planRebalance } from '../keeper/rebalancePlan.js';
import { BPS, INITIAL_UNIT_PRICE_E6, redeemShares, settleCommission, splitMint, unitPrice, valueVault } from '../perf/math.js';
import { E6, pow10, valueE6 } from '../util/money.js';
import { DAY_MS, HOUR_MS } from '../util/time.js';
import { FIXTURE_BUCKETS, FIXTURE_LINK_SHARE, type FixtureAsset, type FixtureBucket } from './design.js';

const SWAP_COST_BPS = 30n;
const HISTORY_DAYS = 186;

/** mulberry32, same generator the design uses for its sample series. */
export function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (s: string) => createHash('sha256').update(s).digest().readUInt32LE(0);

function gaussian(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Deterministic, clearly synthetic base58 address for a fixture entity. */
export function fixtureAddress(label: string): string {
  return new PublicKey(createHash('sha256').update(`bucket-fixture:${label}`).digest()).toBase58();
}

export interface PricePath {
  times: number[];
  prices: bigint[]; // per whole raw token, e6
}

export function priceAt(p: PricePath, t: number): bigint {
  let lo = 0;
  let hi = p.times.length - 1;
  if (t < p.times[0]!) return p.prices[0]!;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return p.prices[lo]!;
}

/**
 * Price path ending at `endPrice` that passes through the asset's return anchors (7/30/90/185 days
 * back), with Brownian-bridge noise between anchors. Steps: 2h over the last 30 days, 6h before.
 */
export function buildPricePath(asset: FixtureAsset, endPrice: number, nowMs: number): PricePath {
  const r = rng(seedOf(asset.ticker));
  const [r7, r30, r90, rAll] = asset.anchors;
  const checkpoints: [number, number][] = [
    [nowMs - HISTORY_DAYS * DAY_MS, Math.log(endPrice) - Math.log(1 + rAll / 100)],
    [nowMs - 90 * DAY_MS, Math.log(endPrice) - Math.log(1 + r90 / 100)],
    [nowMs - 30 * DAY_MS, Math.log(endPrice) - Math.log(1 + r30 / 100)],
    [nowMs - 7 * DAY_MS, Math.log(endPrice) - Math.log(1 + r7 / 100)],
    [nowMs, Math.log(endPrice)],
  ];
  const times: number[] = [];
  const logs: number[] = [];
  for (let c = 0; c < checkpoints.length - 1; c++) {
    const [t0, l0] = checkpoints[c]!;
    const [t1, l1] = checkpoints[c + 1]!;
    const step = t0 >= nowMs - 30 * DAY_MS ? 2 * HOUR_MS : 6 * HOUR_MS;
    const n = Math.max(1, Math.round((t1 - t0) / step));
    const sigma = asset.volDaily * Math.sqrt(step / DAY_MS);
    const walk = [0];
    for (let i = 1; i <= n; i++) walk.push(walk[i - 1]! + sigma * gaussian(r));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      times.push(Math.round(t0 + (t1 - t0) * f));
      logs.push(l0 + (l1 - l0) * f + walk[i]! - f * walk[n]!);
    }
  }
  times.push(nowMs);
  logs.push(Math.log(endPrice));
  return { times, prices: logs.map((l) => BigInt(Math.round(Math.exp(l) * 1e6))) };
}

// ─── Simulation ───────────────────────────────────────────────────────────────────────────────────────

export interface FixtureMarket {
  asset: FixtureAsset;
  mint: string;
  path: PricePath;
}

interface BucketState {
  def: FixtureBucket;
  address: string;
  creator: string;
  holdings: { mint: string; weightBps: number }[];
  balances: Map<string, bigint>;
  supply: bigint;
  hwm: bigint;
  holders: Map<string, bigint>;
  version: number;
}

interface Action {
  t: number;
  run: () => void;
}

export interface FixtureOutput {
  events: RawEvent[];
  creators: { wallet: string; name: string; handle: string }[];
  /** First mint per backer per bucket, with whether it came through a share link. */
  attributions: { wallet: string; bucket: string; at: number; viaLink: boolean }[];
  buckets: { key: string; address: string; prem: number }[];
}

export function simulate(markets: Map<string, FixtureMarket>, nowMs: number): FixtureOutput {
  const events: RawEvent[] = [];
  let seq = 0;
  const emit = (name: EventName, t: number, data: Record<string, unknown>) => {
    seq++;
    events.push({ name, data, signature: `fixture-${seq.toString().padStart(7, '0')}`, slot: 300_000_000 + seq, eventIndex: 0, blockTime: new Date(t), fixture: true });
  };
  const ts = (t: number) => Math.floor(t / 1000).toString();
  const byTicker = (ticker: string) => {
    const m = markets.get(ticker);
    if (!m) throw new Error(`fixture asset ${ticker} missing`);
    return m;
  };
  const mintInfo = new Map([...markets.values()].map((m) => [m.mint, m]));
  const price = (mint: string, t: number) => priceAt(mintInfo.get(mint)!.path, t);
  const decimals = (mint: string) => mintInfo.get(mint)!.asset.decimals;

  const actions: Action[] = [];
  const t0 = nowMs - HISTORY_DAYS * DAY_MS;

  // Allow-list and prices.
  for (const m of markets.values()) {
    actions.push({
      t: t0 - HOUR_MS,
      run: () =>
        emit('AssetAdded', t0 - HOUR_MS, {
          mint: m.mint,
          source: m.asset.source,
          asset_type: m.asset.assetType,
          symbol: m.asset.ticker,
          decimals: m.asset.decimals,
          token_program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
          price_e6: m.path.prices[0]!.toString(),
          extra_cost_bps: m.asset.extraCostBps,
          ts: ts(t0 - HOUR_MS),
        }),
    });
    m.path.times.forEach((t, i) => {
      const p = m.path.prices[i]!.toString();
      actions.push({ t, run: () => emit('PriceUpdated', t, { mint: m.mint, price_e6: p, twap_e6: p, ts: ts(t) }) });
    });
  }

  const out: FixtureOutput = { events, creators: [], attributions: [], buckets: [] };
  let orderSeq = 0;
  const backerPool = Array.from({ length: 1400 }, (_, i) => fixtureAddress(`backer:${i}`));

  for (const [bi, def] of FIXTURE_BUCKETS.entries()) {
    const r = rng(seedOf(`bucket:${def.key}`));
    const creator = fixtureAddress(`creator:${def.key}`);
    const created = nowMs - def.ageDays * DAY_MS + Math.floor(r() * 3) * HOUR_MS;
    const st: BucketState = {
      def,
      address: fixtureAddress(`bucket:${def.key}`),
      creator,
      holdings: def.versions[0]!.holdings.map(([t, w]) => ({ mint: byTicker(t).mint, weightBps: w * 100 })),
      balances: new Map(),
      supply: 0n,
      hwm: INITIAL_UNIT_PRICE_E6,
      holders: new Map(),
      version: 1,
    };
    out.creators.push({ wallet: creator, name: def.creator.name, handle: def.creator.handle });
    out.buckets.push({ key: def.key, address: st.address, prem: def.prem });

    const vault = (t: number) =>
      valueVault([...st.balances].map(([mint, bal]) => ({ mint, available: bal, priceE6: price(mint, t), decimals: decimals(mint) })));

    const settle = (t: number) => {
      const v = vault(t);
      const s = settleCommission({ vaultValueE6: v, supply: st.supply, hwmE6: st.hwm });
      if (!s) return;
      emit('CommissionSettled', t, {
        bucket: st.address,
        vault_value_e6: v.toString(),
        supply_before: st.supply.toString(),
        unit_price_before_e6: s.unitPriceBeforeE6.toString(),
        hwm_before_e6: st.hwm.toString(),
        commission_e6: s.commissionE6.toString(),
        creator_tokens: s.creatorTokens.toString(),
        platform_tokens: s.platformTokens.toString(),
        hwm_after_e6: s.hwmAfterE6.toString(),
        ts: ts(t),
      });
      st.supply = s.supplyAfter;
      st.hwm = s.hwmAfterE6;
      st.holders.set(creator, (st.holders.get(creator) ?? 0n) + s.creatorTokens);
    };

    const mint = (wallet: string, amountE6: bigint, t: number) => {
      settle(t);
      const unit = st.supply > 0n ? unitPrice(vault(t), st.supply)! : INITIAL_UNIT_PRICE_E6;
      const split = splitMint(
        amountE6,
        st.holdings.map((h) => ({ mint: h.mint, valueE6: valueE6(st.balances.get(h.mint) ?? 0n, price(h.mint, t), decimals(h.mint)), weightBps: h.weightBps })),
        st.supply,
      );
      const order = fixtureAddress(`order:${++orderSeq}`);
      emit('MintOpened', t, {
        order,
        bucket: st.address,
        backer: wallet,
        amount_e6: amountE6.toString(),
        fee_e6: split.feeE6.toString(),
        net_e6: split.netE6.toString(),
        unit_price_e6: unit.toString(),
        legs: split.budgets.map((b) => ({ mint: b.mint, amount: b.budgetE6.toString() })),
        ts: ts(t),
      });
      let total = 0n;
      split.budgets.forEach((b, leg) => {
        const tf = t + (leg + 1) * 2000;
        const cost = SWAP_COST_BPS + BigInt(mintInfo.get(b.mint)!.asset.extraCostBps);
        const p = price(b.mint, tf);
        const qty = (((b.budgetE6 * (BPS - cost)) / BPS) * pow10(decimals(b.mint))) / p;
        const tokens = (valueE6(qty, p, decimals(b.mint)) * E6) / unit;
        st.balances.set(b.mint, (st.balances.get(b.mint) ?? 0n) + qty);
        st.supply += tokens;
        total += tokens;
        emit('MintFilled', tf, {
          order,
          bucket: st.address,
          backer: wallet,
          leg,
          mint: b.mint,
          usdc_spent: b.budgetE6.toString(),
          qty: qty.toString(),
          tokens: tokens.toString(),
          vault_balance: st.balances.get(b.mint)!.toString(),
          supply: st.supply.toString(),
          ts: ts(tf),
        });
      });
      st.holders.set(wallet, (st.holders.get(wallet) ?? 0n) + total);
      const tc = t + (split.budgets.length + 1) * 2000;
      emit('MintClosed', tc, { order, bucket: st.address, backer: wallet, refunded_e6: '0', tokens_total: total.toString(), ts: ts(tc) });
    };

    const redeem = (wallet: string, fraction: number, t: number) => {
      settle(t);
      const held = st.holders.get(wallet) ?? 0n;
      const tokens = (held * BigInt(Math.round(fraction * 10_000))) / 10_000n;
      if (tokens <= 0n || st.supply <= tokens) return;
      const unit = unitPrice(vault(t), st.supply)!;
      const legs = redeemShares([...st.balances].map(([mint, available]) => ({ mint, available })), tokens, st.supply).filter((l) => l.qty > 0n);
      st.supply -= tokens;
      st.holders.set(wallet, held - tokens);
      const order = fixtureAddress(`order:${++orderSeq}`);
      emit('Redeemed', t, {
        order,
        bucket: st.address,
        holder: wallet,
        tokens_burned: tokens.toString(),
        fee_tokens: '0',
        unit_price_e6: unit.toString(),
        legs: legs.map((l) => ({ mint: l.mint, amount: l.qty.toString() })),
        supply: st.supply.toString(),
        ts: ts(t),
      });
      legs.forEach((l, leg) => {
        const tf = t + (leg + 1) * 2000;
        const usdcOut = (valueE6(l.qty, price(l.mint, tf), decimals(l.mint)) * (BPS - SWAP_COST_BPS)) / BPS;
        st.balances.set(l.mint, st.balances.get(l.mint)! - l.qty);
        emit('RedeemFilled', tf, {
          order,
          bucket: st.address,
          holder: wallet,
          leg,
          mint: l.mint,
          qty_sold: l.qty.toString(),
          usdc_out: usdcOut.toString(),
          vault_balance: st.balances.get(l.mint)!.toString(),
          ts: ts(tf),
        });
      });
      const tc = t + (legs.length + 1) * 2000;
      emit('RedeemClosed', tc, { order, bucket: st.address, holder: wallet, ts: ts(tc) });
    };

    const holdingsData = (h: [string, number][]) => h.map(([t, w]) => ({ mint: byTicker(t).mint, weight_bps: w * 100 }));

    // Creation and the creator's first mint.
    actions.push({
      t: created,
      run: () =>
        emit('BucketCreated', created, {
          bucket: st.address,
          creator,
          id: String(bi),
          token_mint: fixtureAddress(`bucket-mint:${def.key}`),
          name: def.name,
          thesis: def.thesis,
          holdings: holdingsData(def.versions[0]!.holdings),
          ts: ts(created),
        }),
    });
    actions.push({ t: created + 10 * 60_000, run: () => mint(creator, BigInt(def.creatorStakeUsd) * E6, created + 10 * 60_000) });

    // Backers: design holder count, deposits sized to land near the design's total backed.
    const fullExits = Math.round(def.holders * 0.05);
    const backers = def.holders - 1 + fullExits;
    const median = (def.backedUsd * 0.7) / backers / 1.65;
    const offset = Math.floor(r() * backerPool.length);
    for (let i = 0; i < backers; i++) {
      const wallet = backerPool[(offset + i * 3) % backerPool.length]!; // 3 is coprime with 1400: no repeats
      const t = created + HOUR_MS + Math.pow(r(), 0.75) * (nowMs - created - 2 * HOUR_MS);
      const usd = Math.max(1, Math.min(60_000, median * Math.exp(gaussian(r))));
      const amount = BigInt(Math.round(usd * 100)) * 10_000n;
      actions.push({ t, run: () => mint(wallet, amount, t) });
      out.attributions.push({ wallet, bucket: st.address, at: t, viaLink: r() < FIXTURE_LINK_SHARE });
      if (i < fullExits) {
        const tr = t + r() * (nowMs - t - HOUR_MS);
        actions.push({ t: tr, run: () => redeem(wallet, 1, tr) });
      } else if (r() < 0.1) {
        const tr = t + r() * (nowMs - t - HOUR_MS);
        const f = 0.3 + r() * 0.4;
        actions.push({ t: tr, run: () => redeem(wallet, f, tr) });
      }
    }

    // Daily settlement at a random time 12–24h after the previous one.
    for (let t = created + 12 * HOUR_MS + r() * 12 * HOUR_MS; t < nowMs; t += 12 * HOUR_MS + r() * 12 * HOUR_MS) {
      const at = t;
      actions.push({ t: at, run: () => settle(at) });
    }

    // Edits: proposal, activation 24h later, then one keeper rebalance.
    def.versions.slice(1).forEach((v, i) => {
      const version = i + 2;
      const proposed = nowMs - v.daysAgo * DAY_MS;
      const activated = proposed + DAY_MS + 5 * 60_000;
      const holdings = holdingsData(v.holdings);
      actions.push({
        t: proposed,
        run: () => emit('EditProposed', proposed, { bucket: st.address, version, holdings, note: v.note, effective_at: ts(proposed + DAY_MS) }),
      });
      actions.push({
        t: activated,
        run: () => {
          emit('EditActivated', activated, { bucket: st.address, version, holdings });
          st.holdings = holdings.map((h) => ({ mint: h.mint, weightBps: h.weight_bps }));
          st.version = version;
          const target = new Map(st.holdings.map((h) => [h.mint, h.weightBps]));
          const mints = new Set([...st.balances.keys(), ...target.keys()]);
          const tr = activated + 10 * 60_000;
          const trades = planRebalance(
            [...mints].map((mint) => ({ mint, available: st.balances.get(mint) ?? 0n, priceE6: price(mint, tr), decimals: decimals(mint), weightBps: target.get(mint) ?? 0 })),
            100,
          );
          for (const trade of trades) {
            const qtyOut = (((trade.valueE6 * (BPS - SWAP_COST_BPS)) / BPS) * pow10(decimals(trade.toMint))) / price(trade.toMint, tr);
            st.balances.set(trade.fromMint, (st.balances.get(trade.fromMint) ?? 0n) - trade.qtyIn);
            st.balances.set(trade.toMint, (st.balances.get(trade.toMint) ?? 0n) + qtyOut);
            emit('Rebalanced', tr, {
              bucket: st.address,
              from_mint: trade.fromMint,
              to_mint: trade.toMint,
              qty_in: trade.qtyIn.toString(),
              qty_out: qtyOut.toString(),
              from_balance: st.balances.get(trade.fromMint)!.toString(),
              to_balance: st.balances.get(trade.toMint)!.toString(),
              ts: ts(tr),
            });
          }
        },
      });
    });
    if (def.pending) {
      const p = def.pending;
      const effective = nowMs + p.hoursUntilEffective * HOUR_MS;
      const proposed = effective - DAY_MS;
      actions.push({
        t: proposed,
        run: () =>
          emit('EditProposed', proposed, { bucket: st.address, version: def.versions.length + 1, holdings: holdingsData(p.holdings), note: p.note, effective_at: ts(effective) }),
      });
    }
  }

  actions.sort((a, b) => a.t - b.t);
  for (const a of actions) a.run();
  return out;
}
