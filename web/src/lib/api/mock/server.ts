/**
 * Mock implementation of the Bucket API. Same shapes as the live API; invest, redeem and publish
 * return real (memo-only) v0 transactions signed by a mock fee payer, so the signing path is the
 * same as production. Orders fill one leg every ~650 ms, like the design's Filling state.
 */
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ApiError, type BucketApi, type Caller } from '../client';
import type {
  BucketDetail,
  BucketSummary,
  CreateBucketBody,
  Dashboard,
  LegStatus,
  MintQuote,
  Order,
  Period,
  Portfolio,
  RedeemQuote,
  Source,
} from '../types';
import {
  CATALOG,
  CREATORS,
  RAW_BUCKETS,
  STATS,
  backersByDay,
  bucketAddress,
  chartOf,
  detailOf,
  fakeAddress,
  rawBucket,
  sparkOf,
  summaryOf,
  SHARE_ORIGIN,
} from './fixtures';
import { markGeoBlocked } from '../../geo';
import { loadState, saveState, walletState, type MockOrder, type TxEffect } from './store';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const FEE_PAYER = Keypair.fromSeed(new Uint8Array(32).fill(7));
const LEG_MS = 650;
const SWAP_COST = 0.0035; // design: 0.35% swap cost on the mint route
const MINT_FEE = 0.002; // Config.mint_fee_bps = 20
const POOL_FEE = 0.003;
const REDEEM_COST = 0.003; // design: −0.30% effective vs unit on redeem
const MIN_MINT_ROUTE_USD = 5; // smaller amounts route to the pool (phase-0 decision pending)
const SLIPPAGE_DEMO_USD = 13; // investing exactly $13 simulates a leg that breaches the 1% bound
const GEO_DEMO_USD = 451; // investing exactly $451 simulates a geo-restricted (HTTP 451) caller
const AWAITING_CREATOR_MS = 8_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function randomAddress(): string {
  return bs58.encode(nacl.randomBytes(32));
}

function premiumOf(d: BucketDetail): number {
  return (d.premiumPct ?? 0) / 100;
}

export class MockApi implements BucketApi {
  readonly mode = 'mock' as const;

  // ---------------------------------------------------------------- lookups

  private createdDetail(slugOrAddress: string): BucketDetail | undefined {
    const s = loadState();
    return s.created.find((b) => b.slug === slugOrAddress || b.address === slugOrAddress);
  }

  private findDetail(slugOrAddress: string): BucketDetail {
    const s = loadState();
    const raw = rawBucket(slugOrAddress);
    let d = raw ? detailOf(raw) : this.createdDetail(slugOrAddress);
    if (!d) throw new ApiError('Bucket not found', 404, 'NOT_FOUND');
    if (s.closed.includes(d.slug)) d = { ...d, status: 'closed' };
    const pending = s.pendingEdits[d.slug];
    if (pending) d = { ...d, pendingEdit: pending };
    const info = s.info?.[d.slug];
    if (info) d = { ...d, name: info.name, thesis: info.thesis };
    // A bucket published in this browser waits ~8 s for the creator's first order to fill.
    const awaiting = !raw && Date.now() - new Date(d.createdAt).getTime() < AWAITING_CREATOR_MS;
    return { ...d, fundingState: awaiting ? 'awaiting_creator' : 'funded' };
  }

  private summary(d: BucketDetail): BucketSummary {
    return {
      address: d.address,
      slug: d.slug,
      name: d.name,
      creator: d.creator,
      status: d.status,
      unitPrice: d.unitPrice,
      returns: d.returns,
      maxDrawdown: d.maxDrawdown,
      totalBacked: d.totalBacked,
      holders: d.holders,
      ageDays: d.ageDays,
      topHoldings: d.topHoldings,
      eligible: d.eligible,
      fundingState: d.fundingState,
    };
  }

  // ---------------------------------------------------------------- public reads

  async health() {
    return {
      ok: true,
      cluster: 'devnet',
      programId: fakeAddress('program:bucket_vault'),
      lastSync: new Date(Date.now() - 14 * 60_000).toISOString(),
    };
  }

  async catalog(params: { q?: string; source?: Source } = {}) {
    const q = params.q?.toLowerCase().trim();
    const tokens = CATALOG.filter(
      (c) =>
        (!q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) &&
        (!params.source || c.source === params.source),
    );
    return { tokens, syncedAt: new Date(Date.now() - 14 * 60_000).toISOString() };
  }

  async stats() {
    return { ...STATS };
  }

  async leaderboard(period: Period) {
    const eligible = RAW_BUCKETS.filter((b) => b.eligible && b.status === 'open' && b.ret[period] !== null);
    const ranked = [...eligible].sort((x, y) => (y.ret[period] ?? 0) - (x.ret[period] ?? 0));
    return {
      period,
      updatedAt: new Date(Date.now() - 14 * 60_000).toISOString(),
      rows: ranked.map((b, i) => ({
        ...summaryOf(b),
        rank: i + 1,
        return: b.ret[period],
        spark: sparkOf(b, period, i),
      })),
    };
  }

  async bucket(slugOrAddress: string) {
    return this.findDetail(slugOrAddress);
  }

  async chart(slug: string, period: Period) {
    const raw = rawBucket(slug);
    if (raw) return chartOf(raw, period);
    const d = this.findDetail(slug);
    const now = Date.now();
    const created = new Date(d.createdAt).getTime();
    return {
      points: [
        { t: new Date(created).toISOString(), unitPrice: 100, hwm: 100 },
        { t: new Date(now).toISOString(), unitPrice: parseFloat(d.unitPrice), hwm: parseFloat(d.hwm) },
      ],
    };
  }

  async creator(wallet: string) {
    const s = loadState();
    const fromFixtures = RAW_BUCKETS.filter((b) => b.creator.wallet === wallet).map((b) => this.summary(this.findDetail(b.slug)));
    const created = s.created.filter((b) => b.creator.wallet === wallet).map((b) => this.summary(this.findDetail(b.slug)));
    const buckets = [...created, ...fromFixtures];
    const ref =
      Object.values(CREATORS).find((c) => c.wallet === wallet) ??
      created[0]?.creator ?? { wallet, displayName: null, xHandle: null, xVerified: false };
    if (buckets.length === 0 && !Object.values(CREATORS).some((c) => c.wallet === wallet)) {
      throw new ApiError('Creator not found', 404, 'NOT_FOUND');
    }
    const totalBacked = buckets.reduce((a, b) => a + parseFloat(b.totalBacked), 0);
    return {
      creator: ref,
      buckets,
      totals: {
        totalBacked: totalBacked.toFixed(2),
        bucketCount: buckets.length,
        openBuckets: buckets.filter((b) => b.status === 'open').length,
        holders: buckets.reduce((a, b) => a + b.holders, 0),
      },
    };
  }

  async quoteMint(bucket: string, amountUsd: string): Promise<MintQuote> {
    const d = this.findDetail(bucket);
    const amt = Math.max(0, parseFloat(amountUsd) || 0);
    const unit = parseFloat(d.unitPrice);
    const net = amt * (1 - MINT_FEE);
    const mintTokens = unit > 0 ? net / (unit * (1 + SWAP_COST)) : 0;
    const poolPrice = unit * (1 + premiumOf(d)) * (1 + POOL_FEE);
    const poolTokens = poolPrice > 0 ? amt / poolPrice : 0;
    const mintAvailable = amt >= MIN_MINT_ROUTE_USD && d.status === 'open';
    const poolAvailable = d.poolPrice !== null;
    const mintEff = mintTokens > 0 ? amt / mintTokens : unit;
    const chosen = !mintAvailable ? 'pool' : !poolAvailable || mintTokens >= poolTokens ? 'mint' : 'pool';
    return {
      routes: [
        {
          kind: 'mint',
          available: mintAvailable,
          tokensOut: mintTokens.toFixed(6),
          effectivePrice: mintEff.toFixed(4),
          effectiveVsUnitPct: (mintEff / unit - 1) * 100,
          costUsd: (amt * SWAP_COST).toFixed(2),
        },
        {
          kind: 'pool',
          available: poolAvailable,
          tokensOut: poolTokens.toFixed(6),
          effectivePrice: poolPrice.toFixed(4),
          effectiveVsUnitPct: (poolPrice / unit - 1) * 100,
          costUsd: (amt * POOL_FEE).toFixed(2),
        },
      ],
      chosen,
      feeUsd: chosen === 'mint' ? (amt * MINT_FEE).toFixed(2) : '0.00',
      rentUsd: '0.42',
      legs: d.holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct, usd: ((net * h.weightPct) / 100).toFixed(2) })),
      unitPrice: d.unitPrice,
    };
  }

  async quoteRedeem(bucket: string, tokens: string): Promise<RedeemQuote> {
    const d = this.findDetail(bucket);
    const t = Math.max(0, parseFloat(tokens) || 0);
    const unit = parseFloat(d.unitPrice);
    const redeemOut = t * unit * (1 - REDEEM_COST);
    const poolPx = unit * (1 + premiumOf(d)) * (1 - POOL_FEE);
    const poolOut = t * poolPx;
    const chosen = redeemOut >= poolOut ? 'mint' : 'pool';
    return {
      routes: [
        {
          kind: 'mint',
          available: true,
          usdcOut: redeemOut.toFixed(2),
          effectivePrice: (unit * (1 - REDEEM_COST)).toFixed(4),
          effectiveVsUnitPct: -REDEEM_COST * 100,
          costUsd: (t * unit * REDEEM_COST).toFixed(2),
        },
        {
          kind: 'pool',
          available: d.poolPrice !== null,
          usdcOut: poolOut.toFixed(2),
          effectivePrice: poolPx.toFixed(4),
          effectiveVsUnitPct: (poolPx / unit - 1) * 100,
          costUsd: (t * unit * POOL_FEE).toFixed(2),
        },
      ],
      chosen,
      feeUsd: '0.00',
      rentUsd: '0.00',
      legs: d.holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })),
      unitPrice: d.unitPrice,
    };
  }

  async order(address: string): Promise<Order> {
    const s = loadState();
    const o = s.orders[address];
    if (!o) throw new ApiError('Order not found', 404, 'NOT_FOUND');
    const elapsed = Date.now() - o.createdAt;
    const progressed = Math.floor(elapsed / LEG_MS);
    const legs = o.legs.map((l, i) => {
      let status: LegStatus = i < progressed ? 'filled' : i === progressed ? 'swapping' : 'queued';
      if (i === o.failLeg && i < progressed) status = 'failed';
      return { ticker: l.ticker, weightPct: l.weightPct, status };
    });
    const finished = progressed >= o.legs.length;
    const failedShare = o.failLeg >= 0 ? o.legs[o.failLeg].weightPct / 100 : 0;
    if (finished && !o.settled) {
      o.settled = true;
      const w = walletState(s, o.wallet);
      if (o.kind === 'mint') {
        const got = o.tokens * (1 - failedShare);
        const refund = o.amount * failedShare;
        const pos = w.positions[o.slug] ?? { tokens: 0, cost: 0 };
        w.positions[o.slug] = { tokens: pos.tokens + got, cost: pos.cost + (o.amount - refund) };
        w.usdc += refund;
      } else {
        w.usdc += o.usdcOut;
      }
      saveState();
    }
    const status = !finished ? (progressed === 0 ? 'open' : 'filling') : o.failLeg >= 0 ? 'refunded' : 'done';
    return {
      kind: o.kind,
      status,
      legs,
      tokens: (o.kind === 'mint' ? o.tokens * (1 - failedShare) : o.tokens).toFixed(6),
      usdc: (o.kind === 'mint' ? o.amount * (1 - failedShare) : o.usdcOut).toFixed(2),
    };
  }

  // ---------------------------------------------------------------- signed-in reads

  async me(c: Caller) {
    const s = loadState();
    const w = walletState(s, c.wallet);
    saveState();
    return {
      userId: 'mock:' + c.wallet.slice(0, 8),
      wallet: c.wallet,
      email: w.email,
      xHandle: null,
      xVerified: false,
      usdcBalance: w.usdc.toFixed(2),
      solBalance: '0',
    };
  }

  async portfolio(c: Caller): Promise<Portfolio> {
    const s = loadState();
    const w = walletState(s, c.wallet);
    const positions = Object.entries(w.positions)
      .filter(([, p]) => p.tokens > 0.0000005)
      .map(([slug, p]) => {
        const d = this.findDetail(slug);
        const unit = parseFloat(d.unitPrice);
        const value = p.tokens * unit;
        const gain = value - p.cost;
        return {
          bucket: this.summary(d),
          tokens: p.tokens.toFixed(6),
          unitPrice: d.unitPrice,
          value: value.toFixed(2),
          paid: p.cost.toFixed(2),
          gainUsd: gain.toFixed(2),
          gainPct: p.cost > 0 ? (gain / p.cost) * 100 : 0,
        };
      });
    const value = positions.reduce((a, p) => a + parseFloat(p.value), 0);
    const paid = positions.reduce((a, p) => a + parseFloat(p.paid), 0);
    return {
      positions,
      totals: {
        value: value.toFixed(2),
        paid: paid.toFixed(2),
        gainUsd: (value - paid).toFixed(2),
        gainPct: paid > 0 ? ((value - paid) / paid) * 100 : 0,
        commissionPaid: w.commissionPaid.toFixed(2),
      },
    };
  }

  async dashboard(c: Caller): Promise<Dashboard> {
    const s = loadState();
    // Mock mode shows the design's creator (Kunle Adeyemi) plus anything published in this browser.
    const mine = s.created.filter((b) => b.creator.wallet === c.wallet).map((b) => this.summary(this.findDetail(b.slug)));
    const kunle = RAW_BUCKETS.filter((b) => b.creator.wallet === CREATORS.kunle.wallet).map((b) => this.summary(this.findDetail(b.slug)));
    const buckets = [...mine, ...kunle];
    // Same shape as backend/src/api/routes/me.ts, plus the optional `shared` flag the design draws in yellow.
    return {
      buckets,
      backersByDay: backersByDay().map((d) => ({ day: d.date, newBackers: d.count, depositsUsd: (d.count * 180).toFixed(2), shared: d.shared })),
      commission: {
        grossUsd: '14350.00',
        platformShareUsd: '2870.00',
        creatorShareUsd: '11480.00',
        lastSettlement: { at: new Date('2026-09-02T12:00:00Z').toISOString(), amountUsd: '1240.00' },
      },
      funnel: { linkClicks: 12840, uniqueVisitors: 9610, signedInFromLink: 2410, deposited: 604 },
    };
  }

  // ---------------------------------------------------------------- transactions

  private buildTx(wallet: string, effect: TxEffect): string {
    const s = loadState();
    const id = bs58.encode(nacl.randomBytes(12));
    s.txs[id] = effect;
    saveState();
    const ix = new TransactionInstruction({
      programId: MEMO_PROGRAM,
      keys: [{ pubkey: new PublicKey(wallet), isSigner: true, isWritable: false }],
      data: new TextEncoder().encode(`bucket-mock:${id}`) as unknown as Buffer,
    });
    const msg = new TransactionMessage({
      payerKey: FEE_PAYER.publicKey,
      recentBlockhash: bs58.encode(nacl.randomBytes(32)),
      instructions: [ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([FEE_PAYER]);
    let bin = '';
    const bytes = tx.serialize();
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async txCreateBucket(c: Caller, body: CreateBucketBody) {
    await delay(350);
    const s = loadState();
    const w = walletState(s, c.wallet);
    const stake = parseFloat(body.stakeUsd) || 0;
    const name = body.name.trim();
    if (!name) throw new ApiError('Name your bucket.', 400, 'INVALID');
    if (body.holdings.length < 2 || body.holdings.length > 15) throw new ApiError('Pick 2 to 15 tokens.', 400, 'INVALID');
    const sum = body.holdings.reduce((a, h) => a + h.weightPct, 0);
    if (sum !== 100) throw new ApiError('Weights must sum to 100%.', 400, 'INVALID');
    if (stake < 25) throw new ApiError('Your stake must be at least $25.', 400, 'STAKE_TOO_LOW');
    if (stake > w.usdc) throw new ApiError(`You have ${w.usdc.toFixed(2)} USDC. Add funds to stake $${stake.toFixed(2)}.`, 400, 'INSUFFICIENT_USDC');
    const active = s.created.filter((b) => b.creator.wallet === c.wallet && b.status === 'open').length;
    if (active >= 5) throw new ApiError('A wallet can own at most 5 active buckets.', 400, 'TOO_MANY_BUCKETS');

    let slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bucket';
    let n = 2;
    const base = slug;
    while (rawBucket(slug) || s.created.some((b) => b.slug === slug)) slug = `${base}-${n++}`;
    const address = bucketAddress({ slug });
    const now = new Date().toISOString();
    const holdings = body.holdings.map((h) => {
      const t = CATALOG.find((x) => x.mint === h.mint);
      if (!t) throw new ApiError('Unknown token in holdings.', 400, 'INVALID');
      const value = (stake * (1 - MINT_FEE) * h.weightPct) / 100;
      const price = parseFloat(t.price);
      const mark = t.markPrice ? parseFloat(t.markPrice) : null;
      return {
        mint: t.mint, ticker: t.ticker, name: t.name, source: t.source, assetType: t.assetType,
        weightPct: h.weightPct, price: t.price, markPrice: t.markPrice,
        markGapPct: mark ? (price / mark - 1) * 100 : null, contributionPct: null,
        balance: (value / price).toFixed(6), valueUsd: value.toFixed(2),
      };
    });
    const top = [...holdings].sort((a, b) => b.weightPct - a.weightPct).slice(0, 3);
    const bucket: BucketDetail = {
      address, slug, name, status: 'open',
      creator: { wallet: c.wallet, displayName: null, xHandle: null, xVerified: false },
      unitPrice: '100.00', returns: { '7d': null, '30d': null, '90d': null, all: null }, maxDrawdown: 0,
      totalBacked: (stake * (1 - MINT_FEE)).toFixed(2), holders: 1, ageDays: 0,
      topHoldings: top.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })), eligible: false,
      thesis: body.thesis.trim(), createdAt: now, version: 1,
      tokenMint: fakeAddress('bucket-mint:' + slug), vault: fakeAddress('vault:' + slug),
      supply: ((stake * (1 - MINT_FEE)) / 100).toFixed(6), hwm: '100.00', poolPrice: '100.00', premiumPct: 0,
      holdings, preIpoSharePct: holdings.filter((h) => h.assetType === 'pre_ipo').reduce((a, h) => a + h.weightPct, 0),
      versions: [{ version: 1, activatedAt: now, holdings: holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })), note: null, changeSummary: holdings.map((h) => `${h.ticker} ${h.weightPct}%`).join(', ') }],
      pendingEdit: null, lastSettledAt: now, eventCount: 3, shareUrl: `${SHARE_ORIGIN}/b/${slug}`,
    };
    // Two transactions like the real flow: vault token accounts + lookup table, then create + first mint.
    const transactions = [
      this.buildTx(c.wallet, { kind: 'create', wallet: c.wallet, bucket, stake, step: 1, steps: 2 }),
      this.buildTx(c.wallet, { kind: 'create', wallet: c.wallet, bucket, stake, step: 2, steps: 2 }),
    ];
    return { transactions, bucket: address, slug };
  }

  async txMint(c: Caller, body: { bucket: string; amountUsd: string }) {
    await delay(300);
    const s = loadState();
    const w = walletState(s, c.wallet);
    const d = this.findDetail(body.bucket);
    const amount = parseFloat(body.amountUsd) || 0;
    if (Math.abs(amount - GEO_DEMO_USD) < 1e-9) {
      markGeoBlocked();
      throw new ApiError("Bucket isn't available in your region", 451, 'geo_restricted');
    }
    if (d.status === 'closed') throw new ApiError('This bucket is closed to new money. Redeem stays open.', 400, 'BUCKET_CLOSED');
    if (d.fundingState === 'awaiting_creator' && d.creator.wallet !== c.wallet) {
      throw new ApiError("The creator's first mint has to land before anyone else can mint", 400, 'bad_request');
    }
    if (amount < 1) throw new ApiError('The minimum is $1.', 400, 'AMOUNT_TOO_LOW');
    if (amount > w.usdc + 1e-9) throw new ApiError(`You have ${w.usdc.toFixed(2)} USDC in your wallet.`, 400, 'INSUFFICIENT_USDC');
    const q = await this.quoteMint(d.slug, body.amountUsd);
    const route = q.chosen;
    if (!route) throw new ApiError('No route can fill this amount right now.', 400, 'bad_request');
    const r = q.routes.find((x) => x.kind === route)!;
    const order = route === 'mint' ? randomAddress() : null;
    const transaction = this.buildTx(c.wallet, { kind: 'mint', wallet: c.wallet, slug: d.slug, amount, order, route, tokens: parseFloat(r.tokensOut) });
    return { transaction, order };
  }

  async txRedeem(c: Caller, body: { bucket: string; tokens: string }) {
    await delay(300);
    const s = loadState();
    const w = walletState(s, c.wallet);
    const d = this.findDetail(body.bucket);
    const t = parseFloat(body.tokens) || 0;
    const pos = w.positions[d.slug];
    if (!pos || pos.tokens + 1e-9 < t || t <= 0) throw new ApiError('You do not hold that many tokens of this bucket.', 400, 'INSUFFICIENT_TOKENS');
    const q = await this.quoteRedeem(d.slug, body.tokens);
    const r = q.routes.find((x) => x.kind === q.chosen)!;
    const order = q.chosen === 'mint' ? randomAddress() : null;
    const transaction = this.buildTx(c.wallet, { kind: 'redeem', wallet: c.wallet, slug: d.slug, tokens: Math.min(t, pos.tokens), order, usdcOut: parseFloat(r.usdcOut) });
    return { transaction, order };
  }

  async txCloseBucket(c: Caller, body: { bucket: string }) {
    await delay(250);
    const d = this.findDetail(body.bucket);
    if (d.creator.wallet !== c.wallet) throw new ApiError('Only the creator can close this bucket.', 403, 'FORBIDDEN');
    return { transaction: this.buildTx(c.wallet, { kind: 'close', wallet: c.wallet, slug: d.slug }) };
  }

  async txProposeEdit(c: Caller, body: { bucket: string; holdings: { mint: string; weightPct: number }[]; note: string }) {
    await delay(250);
    const d = this.findDetail(body.bucket);
    if (d.creator.wallet !== c.wallet) throw new ApiError('Only the creator can edit this bucket.', 403, 'FORBIDDEN');
    if (d.pendingEdit) throw new ApiError('An edit is already pending.', 400, 'EDIT_PENDING');
    const next = body.holdings.map((h) => ({ ticker: CATALOG.find((t) => t.mint === h.mint)?.ticker ?? '?', pct: h.weightPct }));
    const tickers = Array.from(new Set([...d.holdings.map((h) => h.ticker), ...next.map((n) => n.ticker)]));
    const pending = {
      version: d.version + 1,
      effectiveAt: new Date(Date.now() + 86_400_000).toISOString(),
      note: body.note.trim() || null,
      diff: tickers.map((ticker) => ({
        ticker,
        fromPct: d.holdings.find((h) => h.ticker === ticker)?.weightPct ?? null,
        toPct: next.find((n) => n.ticker === ticker)?.pct ?? null,
      })),
    };
    return { transaction: this.buildTx(c.wallet, { kind: 'edit', wallet: c.wallet, slug: d.slug, pending }) };
  }

  async txUpdateInfo(c: Caller, body: { bucket: string; name: string; thesis: string }) {
    await delay(250);
    const d = this.findDetail(body.bucket);
    if (d.creator.wallet !== c.wallet) throw new ApiError('Only the creator can edit a bucket', 403, 'forbidden');
    const name = body.name.trim();
    if (!name) throw new ApiError('Name or thesis does not meet the rules: name is required', 400, 'bad_request');
    return { transaction: this.buildTx(c.wallet, { kind: 'info', wallet: c.wallet, slug: d.slug, name, thesis: body.thesis.trim() }) };
  }

  async txSubmit(c: Caller, body: { transaction: string }) {
    await delay(250);
    const s = loadState();
    const bin = atob(body.transaction);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const tx = VersionedTransaction.deserialize(bytes);
    const keys = tx.message.staticAccountKeys;
    const signerCount = tx.message.header.numRequiredSignatures;
    const msgBytes = tx.message.serialize();
    for (let i = 0; i < signerCount; i++) {
      if (!nacl.sign.detached.verify(msgBytes, tx.signatures[i], keys[i].toBytes())) {
        throw new ApiError('Transaction is missing a valid signature.', 400, 'BAD_SIGNATURE');
      }
    }
    const memo = tx.message.compiledInstructions[0];
    const text = new TextDecoder().decode(memo.data);
    const id = text.replace(/^bucket-mock:/, '');
    const effect = s.txs[id];
    if (!effect) throw new ApiError('This transaction expired. Try again.', 400, 'EXPIRED');
    if (effect.wallet !== c.wallet) throw new ApiError('Signed by a different wallet.', 400, 'BAD_SIGNATURE');
    delete s.txs[id];
    const w = walletState(s, effect.wallet);
    switch (effect.kind) {
      case 'mint': {
        w.usdc -= effect.amount;
        if (effect.order) {
          const d = this.findDetail(effect.slug);
          const order: MockOrder = {
            kind: 'mint', wallet: effect.wallet, slug: effect.slug, createdAt: Date.now(),
            legs: d.holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })),
            failLeg: Math.abs(effect.amount - SLIPPAGE_DEMO_USD) < 1e-9 ? d.holdings.length - 1 : -1,
            amount: effect.amount, tokens: effect.tokens, usdcOut: 0, settled: false,
          };
          s.orders[effect.order] = order;
        } else {
          const pos = w.positions[effect.slug] ?? { tokens: 0, cost: 0 };
          w.positions[effect.slug] = { tokens: pos.tokens + effect.tokens, cost: pos.cost + effect.amount };
        }
        break;
      }
      case 'redeem': {
        const pos = w.positions[effect.slug];
        if (pos) {
          const frac = Math.min(1, effect.tokens / pos.tokens);
          w.positions[effect.slug] = { tokens: pos.tokens - effect.tokens, cost: pos.cost * (1 - frac) };
          if (w.positions[effect.slug].tokens < 0.0000005) delete w.positions[effect.slug];
        }
        if (effect.order) {
          const d = this.findDetail(effect.slug);
          s.orders[effect.order] = {
            kind: 'redeem', wallet: effect.wallet, slug: effect.slug, createdAt: Date.now(),
            legs: d.holdings.map((h) => ({ ticker: h.ticker, weightPct: h.weightPct })), failLeg: -1,
            amount: 0, tokens: effect.tokens, usdcOut: effect.usdcOut, settled: false,
          };
        } else {
          w.usdc += effect.usdcOut;
        }
        break;
      }
      case 'create': {
        if (effect.step === effect.steps) {
          s.created = [effect.bucket, ...s.created.filter((b) => b.slug !== effect.bucket.slug)];
          w.usdc -= effect.stake;
          w.positions[effect.bucket.slug] = { tokens: parseFloat(effect.bucket.supply), cost: effect.stake };
        }
        break;
      }
      case 'close': {
        if (!s.closed.includes(effect.slug)) s.closed.push(effect.slug);
        break;
      }
      case 'edit': {
        s.pendingEdits[effect.slug] = effect.pending;
        break;
      }
      case 'info': {
        s.info[effect.slug] = { name: effect.name, thesis: effect.thesis };
        break;
      }
    }
    saveState();
    return { signature: bs58.encode(tx.signatures[1] ?? tx.signatures[0]) };
  }

  async faucet(c: Caller) {
    await delay(300);
    const s = loadState();
    walletState(s, c.wallet).usdc += 1000;
    saveState();
    return { amountUsd: '1000.00', signature: bs58.encode(nacl.randomBytes(64)) };
  }

  async setNotifications(c: Caller, body: { email?: string }) {
    await delay(200);
    const s = loadState();
    walletState(s, c.wallet).email = body.email?.trim() || null;
    saveState();
    return { ok: true };
  }

  async linkClick() {
    /* recorded by the backend in live mode */
  }
}

