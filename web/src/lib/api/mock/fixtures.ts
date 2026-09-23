/**
 * Mock fixtures derived from design/Bucket.dc.html sample data: the 20-token catalog, six ranked
 * buckets, the portfolio positions and the creator dashboard numbers. Shapes match architecture §3.
 */
import bs58 from 'bs58';
import type {
  AssetType,
  BucketDetail,
  BucketSummary,
  BucketVersion,
  CatalogToken,
  CreatorRef,
  Holding,
  Period,
  Source,
} from '../types';

// ---------------------------------------------------------------------------------------------
// Deterministic helpers (same PRNG as the design)

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

/** The design's series(): n points drifting from 100 to 100 × (1 + total%). */
export function series(seed: number, n: number, total: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  let v = 100;
  const drift = Math.pow(1 + total / 100, 1 / n);
  for (let i = 0; i < n; i++) {
    v = v * drift * (1 + (r() - 0.5) * 0.055);
    out.push(v);
  }
  const last = out[out.length - 1];
  const target = 100 * (1 + total / 100);
  return out.map((x, i) => x * (1 + (target / last - 1) * (i / (n - 1))));
}

/** A stable fake base58 address for a label. */
export function fakeAddress(label: string): string {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  const r = rng(h);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(r() * 256);
  return bs58.encode(bytes);
}

const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Catalog (design: catalog[])

interface RawToken {
  t: string;
  n: string;
  s: Source;
  p: number;
  m?: number;
  etf?: boolean;
}

const RAW_CATALOG: RawToken[] = [
  { t: 'NVDAx', n: 'NVIDIA', s: 'xStocks', p: 184.2 },
  { t: 'MSFTx', n: 'Microsoft', s: 'xStocks', p: 519.8 },
  { t: 'AAPLx', n: 'Apple', s: 'xStocks', p: 258.4 },
  { t: 'GOOGLx', n: 'Alphabet', s: 'xStocks', p: 246.1 },
  { t: 'AMZNx', n: 'Amazon', s: 'xStocks', p: 231.7 },
  { t: 'METAx', n: 'Meta Platforms', s: 'xStocks', p: 742.3 },
  { t: 'TSLAx', n: 'Tesla', s: 'xStocks', p: 412.9 },
  { t: 'PLTRx', n: 'Palantir', s: 'xStocks', p: 176.5 },
  { t: 'COINx', n: 'Coinbase', s: 'xStocks', p: 318.55 },
  { t: 'HOODx', n: 'Robinhood', s: 'xStocks', p: 118.4 },
  { t: 'CRCLx', n: 'Circle', s: 'xStocks', p: 152.9 },
  { t: 'MSTRx', n: 'Strategy', s: 'xStocks', p: 344.15 },
  { t: 'SPYx', n: 'S&P 500 ETF', s: 'xStocks', p: 664.2, etf: true },
  { t: 'QQQx', n: 'Nasdaq-100 ETF', s: 'xStocks', p: 601.4, etf: true },
  { t: 'pSPACEX', n: 'SpaceX', s: 'PreStocks', p: 119.05, m: 154.2 },
  { t: 'pOPENAI', n: 'OpenAI', s: 'PreStocks', p: 84.6, m: 96.4 },
  { t: 'pANTHROPIC', n: 'Anthropic', s: 'PreStocks', p: 72.15, m: 88.9 },
  { t: 'pANDURIL', n: 'Anduril', s: 'PreStocks', p: 61.3, m: 70.05 },
  { t: 'tSTRIPE', n: 'Stripe', s: 'Tessera', p: 44.8, m: 51.2 },
  { t: 'tDATABRICKS', n: 'Databricks', s: 'Tessera', p: 38.95, m: 42.6 },
];

function assetTypeOf(r: RawToken): AssetType {
  if (r.s !== 'xStocks') return 'pre_ipo';
  return r.etf ? 'etf' : 'public_stock';
}

export const CATALOG: CatalogToken[] = RAW_CATALOG.map((r, i) => ({
  mint: fakeAddress('mint:' + r.t),
  ticker: r.t,
  name: r.n,
  source: r.s,
  assetType: assetTypeOf(r),
  price: r.p.toFixed(2),
  markPrice: r.m !== undefined ? r.m.toFixed(2) : null,
  liquidityUsd: String(r.s === 'xStocks' ? 4_000_000 + i * 750_000 : 260_000 + i * 40_000),
  decimals: r.s === 'xStocks' ? 8 : 6,
  logo: null,
  eligible: true,
  flagged: false,
  maxWeightPct: r.s === 'xStocks' ? 50 : 25,
}));

export function catalogToken(ticker: string): CatalogToken {
  const c = CATALOG.find((x) => x.ticker === ticker);
  if (!c) throw new Error(`unknown ticker ${ticker}`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Creators

function creator(displayName: string, xHandle: string, xVerified = true): CreatorRef {
  return { wallet: fakeAddress('creator:' + xHandle), displayName, xHandle, xVerified };
}

export const CREATORS = {
  amara: creator('Amara Eze', '@amaraonchain'),
  kunle: creator('Kunle Adeyemi', '@kunlebuilds'),
  tobi: creator('Tobi Bello', '@tobibello'),
  nneka: creator('Nneka Okoro', '@nnekaokoro', false),
  dele: creator('Dele Ajayi', '@deleajayi'),
  sade: creator('Sade Coker', '@sadecoker'),
};

// ---------------------------------------------------------------------------------------------
// Buckets (design: buckets[])

interface RawVersion {
  daysAgo: number;
  holdings: [string, number][];
  change: string;
  note: string | null;
}

export interface RawBucket {
  id: string;
  slug: string;
  name: string;
  creator: CreatorRef;
  thesis: string;
  unit: number;
  hwm: number;
  prem: number;
  ret: Record<Period, number | null>;
  dd: number;
  backed: number;
  holders: number;
  age: number;
  status: 'open' | 'closed';
  eligible: boolean;
  /** [ticker, weight %, contribution %] */
  h: [string, number, number][];
  versions: RawVersion[];
  pending?: boolean;
  seed: number;
}

export const RAW_BUCKETS: RawBucket[] = [
  {
    id: 'frontier', slug: 'frontier-labs', name: 'Frontier Labs', creator: CREATORS.amara, seed: 11,
    thesis:
      'The four companies actually building frontier compute and the models that run on it. Pre-IPO where the upside still is, listed where the earnings are.',
    unit: 214.9, hwm: 214.9, prem: 0.006, ret: { '7d': 5.8, '30d': 31.4, '90d': 58.2, all: 114.9 },
    dd: -18.6, backed: 1_204_000, holders: 388, age: 96, status: 'open', eligible: true,
    h: [['pOPENAI', 25, 9.4], ['pANTHROPIC', 25, 8.1], ['pSPACEX', 25, 6.2], ['NVDAx', 25, 7.7]],
    versions: [
      { daysAgo: 96, holdings: [['NVDAx', 40], ['pOPENAI', 25], ['pSPACEX', 25], ['MSFTx', 10]], change: 'NVDAx 40%, pOPENAI 30%, pSPACEX 30%', note: null },
      { daysAgo: 64, holdings: [['NVDAx', 30], ['pOPENAI', 20], ['pSPACEX', 25], ['pANTHROPIC', 25]], change: 'Added pANTHROPIC at 20%, trimmed NVDAx', note: 'Model layer is worth owning directly.' },
      { daysAgo: 19, holdings: [['pOPENAI', 25], ['pANTHROPIC', 25], ['pSPACEX', 25], ['NVDAx', 25]], change: 'NVDAx 30% → 25%, pOPENAI 20% → 25%', note: 'Rotating a little further up the risk curve.' },
    ],
    pending: true,
  },
  {
    id: 'picks', slug: 'picks-and-shovels', name: 'Picks & Shovels', creator: CREATORS.kunle, seed: 23,
    thesis:
      'Nobody knows which model wins. Everyone knows who sells the compute, the cloud and the deployment layer underneath it.',
    unit: 168.42, hwm: 171.3, prem: -0.004, ret: { '7d': 2.1, '30d': 24.8, '90d': 41.3, all: 68.4 },
    dd: -11.2, backed: 842_000, holders: 214, age: 118, status: 'open', eligible: true,
    h: [['NVDAx', 30, 11.2], ['MSFTx', 20, 4.4], ['pANTHROPIC', 20, 6.9], ['AMZNx', 15, 1.1], ['PLTRx', 15, 1.2]],
    versions: [
      { daysAgo: 118, holdings: [['NVDAx', 35], ['MSFTx', 25], ['AMZNx', 25], ['PLTRx', 15]], change: 'NVDAx 35%, MSFTx 25%, AMZNx 25%, PLTRx 15%', note: null },
      { daysAgo: 71, holdings: [['NVDAx', 35], ['MSFTx', 20], ['pANTHROPIC', 15], ['AMZNx', 15], ['PLTRx', 15]], change: 'Added pANTHROPIC at 15%, trimmed MSFTx and AMZNx', note: 'The model layer buys shovels too.' },
      { daysAgo: 24, holdings: [['NVDAx', 30], ['MSFTx', 20], ['pANTHROPIC', 20], ['AMZNx', 15], ['PLTRx', 15]], change: 'NVDAx 35% → 30%, pANTHROPIC 15% → 20%', note: 'Taking a little off the top of NVIDIA.' },
    ],
  },
  {
    id: 'crypto', slug: 'crypto-equities', name: 'Crypto Equities', creator: CREATORS.tobi, seed: 37,
    thesis:
      'Owning the exchanges, brokers and issuers is a cleaner bet on crypto adoption than owning the coins.',
    unit: 183.55, hwm: 190.2, prem: 0.011, ret: { '7d': -3.2, '30d': 19.1, '90d': 27.6, all: 83.6 },
    dd: -22.4, backed: 655_000, holders: 173, age: 142, status: 'open', eligible: true,
    h: [['COINx', 30, 8.8], ['HOODx', 25, 5.2], ['CRCLx', 25, 3.4], ['MSTRx', 20, 1.7]],
    versions: [
      { daysAgo: 142, holdings: [['COINx', 35], ['HOODx', 25], ['CRCLx', 20], ['MSTRx', 20]], change: 'COINx 35%, HOODx 25%, CRCLx 20%, MSTRx 20%', note: null },
      { daysAgo: 40, holdings: [['COINx', 30], ['HOODx', 25], ['CRCLx', 25], ['MSTRx', 20]], change: 'COINx 35% → 30%, CRCLx 20% → 25%', note: "Circle's float is finally big enough." },
    ],
  },
  {
    id: 'defense', slug: 'defense-and-space', name: 'Defense & Space', creator: CREATORS.nneka, seed: 41,
    thesis: 'Autonomy and launch are being rebuilt by three companies, two of which are still private.',
    unit: 142.3, hwm: 142.3, prem: 0.003, ret: { '7d': 1.4, '30d': 12.7, '90d': 22.8, all: 42.3 },
    dd: -9.8, backed: 288_000, holders: 74, age: 74, status: 'open', eligible: true,
    h: [['pSPACEX', 25, 4.1], ['pANDURIL', 25, 3.6], ['PLTRx', 30, 3.4], ['METAx', 20, 1.6]],
    versions: [
      { daysAgo: 74, holdings: [['pSPACEX', 25], ['pANDURIL', 25], ['PLTRx', 30], ['METAx', 20]], change: 'pSPACEX 25%, pANDURIL 25%, PLTRx 30%, METAx 20%', note: null },
    ],
  },
  {
    id: 'boring', slug: 'boring-compounders', name: 'Boring Compounders', creator: CREATORS.dele, seed: 53,
    thesis:
      'Four things I will still hold in 2036. Low turnover by design, and I will not touch the weights for a year.',
    unit: 128.1, hwm: 128.1, prem: -0.002, ret: { '7d': 0.9, '30d': 6.2, '90d': 11.4, all: 28.1 },
    dd: -4.1, backed: 410_000, holders: 96, age: 165, status: 'open', eligible: true,
    h: [['MSFTx', 30, 2.1], ['AAPLx', 25, 1.4], ['GOOGLx', 25, 1.8], ['SPYx', 20, 0.9]],
    versions: [
      { daysAgo: 165, holdings: [['MSFTx', 30], ['AAPLx', 25], ['GOOGLx', 25], ['SPYx', 20]], change: 'MSFTx 30%, AAPLx 25%, GOOGLx 25%, SPYx 20%', note: null },
    ],
  },
  {
    id: 'index', slug: 'everything-index', name: 'Everything Index', creator: CREATORS.sade, seed: 67,
    thesis: 'The default bucket. Two broad ETFs and the two largest listed companies, rebalanced never.',
    unit: 112.05, hwm: 112.05, prem: 0.001, ret: { '7d': 0.4, '30d': 4.4, '90d': 8.1, all: 12.1 },
    dd: -5.2, backed: 1_920_000, holders: 512, age: 181, status: 'open', eligible: true,
    h: [['SPYx', 40, 1.8], ['QQQx', 30, 1.5], ['AAPLx', 15, 0.6], ['MSFTx', 15, 0.5]],
    versions: [
      { daysAgo: 181, holdings: [['SPYx', 40], ['QQQx', 30], ['AAPLx', 15], ['MSFTx', 15]], change: 'SPYx 40%, QQQx 30%, AAPLx 15%, MSFTx 15%', note: null },
    ],
  },
  // Two more of Kunle's buckets, so his profile shows an unranked (too young) and a closed, losing one.
  {
    id: 'hyper', slug: 'hyperscalers', name: 'Hyperscalers', creator: CREATORS.kunle, seed: 79,
    thesis: 'The four companies spending the most on AI capex. Too young for the leaderboard until it turns 14 days.',
    unit: 103.1, hwm: 103.4, prem: 0.002, ret: { '7d': 2.3, '30d': null, '90d': null, all: 3.1 },
    dd: -2.4, backed: 1_450, holders: 3, age: 9, status: 'open', eligible: false,
    h: [['NVDAx', 40, 1.4], ['MSFTx', 20, 0.6], ['GOOGLx', 20, 0.7], ['AMZNx', 20, 0.4]],
    versions: [
      { daysAgo: 9, holdings: [['NVDAx', 40], ['MSFTx', 20], ['GOOGLx', 20], ['AMZNx', 20]], change: 'NVDAx 40%, MSFTx 20%, GOOGLx 20%, AMZNx 20%', note: null },
    ],
  },
  {
    id: 'metaverse', slug: 'metaverse-bet', name: 'Metaverse Bet', creator: CREATORS.kunle, seed: 83,
    thesis: 'Headsets become the next phone. They did not, so this bucket is closed to new money. Redeem stays open.',
    unit: 78.7, hwm: 100, prem: -0.013, ret: { '7d': -0.8, '30d': -4.9, '90d': -14.2, all: -21.3 },
    dd: -34.0, backed: 3_120, holders: 11, age: 160, status: 'closed', eligible: false,
    h: [['METAx', 50, -12.4], ['AAPLx', 25, -3.1], ['GOOGLx', 25, -5.8]],
    versions: [
      { daysAgo: 160, holdings: [['METAx', 50], ['AAPLx', 25], ['GOOGLx', 25]], change: 'METAx 50%, AAPLx 25%, GOOGLx 25%', note: null },
    ],
  },
];

export const SHARE_ORIGIN = 'https://bucket.xyz';

export function rawBucket(slugOrAddress: string): RawBucket | undefined {
  return RAW_BUCKETS.find((b) => b.slug === slugOrAddress || bucketAddress(b) === slugOrAddress || b.id === slugOrAddress);
}

export function bucketAddress(b: { slug: string }): string {
  return fakeAddress('bucket:' + b.slug);
}

function holdingsOf(b: RawBucket): Holding[] {
  return b.h.map(([ticker, w, contrib]) => {
    const c = catalogToken(ticker);
    const price = parseFloat(c.price);
    const mark = c.markPrice ? parseFloat(c.markPrice) : null;
    const value = (b.backed * w) / 100;
    return {
      mint: c.mint,
      ticker: c.ticker,
      name: c.name,
      source: c.source,
      assetType: c.assetType,
      weightPct: w,
      price: c.price,
      markPrice: c.markPrice,
      markGapPct: mark ? (price / mark - 1) * 100 : null,
      contributionPct: contrib,
      balance: (value / price).toFixed(6),
      valueUsd: value.toFixed(2),
    };
  });
}

export function summaryOf(b: RawBucket): BucketSummary {
  const top = [...b.h].sort((x, y) => y[1] - x[1]).slice(0, 3);
  return {
    address: bucketAddress(b),
    slug: b.slug,
    name: b.name,
    creator: b.creator,
    status: b.status,
    unitPrice: b.unit.toFixed(2),
    returns: { ...b.ret },
    maxDrawdown: b.dd,
    totalBacked: b.backed.toFixed(2),
    holders: b.holders,
    ageDays: b.age,
    topHoldings: top.map(([ticker, weightPct]) => ({ ticker, weightPct })),
    eligible: b.eligible,
  };
}

export function detailOf(b: RawBucket, now = Date.now()): BucketDetail {
  const holdings = holdingsOf(b);
  const versions: BucketVersion[] = b.versions
    .map((v, i) => ({
      version: i + 1,
      activatedAt: new Date(now - v.daysAgo * DAY).toISOString(),
      holdings: v.holdings.map(([ticker, weightPct]) => ({ ticker, weightPct })),
      note: v.note,
      changeSummary: v.change,
    }))
    .reverse();
  const preIpoSharePct = holdings.filter((h) => h.assetType === 'pre_ipo').reduce((a, h) => a + h.weightPct, 0);
  return {
    ...summaryOf(b),
    thesis: b.thesis,
    createdAt: new Date(now - b.age * DAY).toISOString(),
    version: b.versions.length,
    tokenMint: fakeAddress('bucket-mint:' + b.slug),
    vault: fakeAddress('vault:' + b.slug),
    supply: (b.backed / b.unit).toFixed(6),
    hwm: b.hwm.toFixed(2),
    poolPrice: (b.unit * (1 + b.prem)).toFixed(2),
    premiumPct: b.prem * 100,
    holdings,
    preIpoSharePct,
    versions,
    pendingEdit: b.pending
      ? {
          version: b.versions.length + 1,
          effectiveAt: new Date(now + (18 * 60 + 24) * 60_000).toISOString(),
          note: 'Trimming pSPACEX to fund a position in tSTRIPE.',
          diff: [
            { ticker: 'pOPENAI', fromPct: 25, toPct: 25 },
            { ticker: 'pANTHROPIC', fromPct: 25, toPct: 25 },
            { ticker: 'pSPACEX', fromPct: 25, toPct: 10 },
            { ticker: 'NVDAx', fromPct: 25, toPct: 25 },
            { ticker: 'tSTRIPE', fromPct: null, toPct: 15 },
          ],
        }
      : null,
    lastSettledAt: new Date(now - 11 * 60_000).toISOString(),
    eventCount: b.holders * 9 + 214,
    shareUrl: `${SHARE_ORIGIN}/b/${b.slug}`,
  };
}

/** Unit price series for a period, ending at the current unit price, with a running high-water mark. */
export function chartOf(b: { unit: number; hwm: number; ret: Record<Period, number | null>; age: number; seed: number }, period: Period, now = Date.now()) {
  const n = 90;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : Math.max(1, b.age);
  const spanDays = Math.min(days, Math.max(1, b.age));
  const total = b.ret[period] ?? b.ret.all ?? 0;
  const raw = series(b.seed, n, total);
  const scale = b.unit / raw[raw.length - 1];
  const unit = raw.map((v) => v * scale);
  // Keep the series under the bucket's recorded high-water mark, then draw the mark as a running max.
  // Below the high, compress the part above today's price so the peak lands exactly on the mark
  // (keeps the shape instead of flattening it).
  const peak = Math.max(...unit);
  const squeezed =
    b.hwm > b.unit && peak > b.hwm
      ? unit.map((v) => (v <= b.unit ? v : b.unit + ((v - b.unit) * (b.hwm - b.unit)) / (peak - b.unit)))
      : unit;
  const capped = squeezed.map((v) => Math.min(v, b.hwm));
  let running = Math.max(capped[0], b.hwm === b.unit ? capped[0] : Math.min(b.hwm, Math.max(...capped)));
  const peakBeforeWindow = Math.max(...capped) < b.hwm;
  const points = capped.map((v, i) => {
    running = Math.max(running, v);
    const hwm = peakBeforeWindow ? b.hwm : running;
    const t = new Date(now - spanDays * DAY * (1 - i / (n - 1))).toISOString();
    return { t, unitPrice: Number(v.toFixed(4)), hwm: Number(hwm.toFixed(4)) };
  });
  return { points };
}

export function sparkOf(b: RawBucket, period: Period, rank: number): number[] {
  const total = b.ret[period] ?? 0;
  return series(rank * 37 + 7, 40, total).map((v) => Number(v.toFixed(3)));
}

// ---------------------------------------------------------------------------------------------
// Aggregates (design: lbKpis, dashKpis, commRows, funnel, positions)

export const STATS = {
  totalBacked: '5320000.00',
  bucketCount: 1284,
  backers: 9412,
  commissionPaid: '184000.00',
  creatorsPaid: 128,
  medianPoolGapPct: 0.4,
  shareLinkBackerPct: 64,
};

export const START_USDC = 4820.55;

export const START_POSITIONS: Record<string, { tokens: number; cost: number }> = {
  'picks-and-shovels': { tokens: 12.4, cost: 1750 },
  'frontier-labs': { tokens: 8.1, cost: 1500 },
  'everything-index': { tokens: 20, cost: 2100 },
};

export const START_COMMISSION_PAID = 218;

export function backersByDay(now = Date.now()) {
  const r = rng(5);
  return Array.from({ length: 30 }, (_, i) => {
    const spike = i === 6 || i === 17 || i === 25;
    const h = spike ? 78 + r() * 20 : 16 + r() * 48;
    return {
      date: new Date(now - (29 - i) * DAY).toISOString().slice(0, 10),
      count: Math.round(h / 4),
      shared: spike,
    };
  });
}
