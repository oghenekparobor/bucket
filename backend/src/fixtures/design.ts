/**
 * Fixture dataset from the design's sample data (design/Bucket.dc.html <script> block): the 20-token
 * catalog, six buckets, their creators, holders, ages and edit histories. Real mainnet mints are used
 * where the token exists today; tSTRIPE and tDATABRICKS are not listed by Tessera, so they get synthetic
 * fixture mints. Per-asset return anchors (gross, before commission) are tuned so the simulated buckets
 * land near the design's returns.
 */
import type { AssetType, Source } from '../catalog/types.js';

export interface FixtureAsset {
  ticker: string;
  name: string;
  source: Source;
  assetType: AssetType;
  mint: string | null; // null → synthetic fixture mint
  decimals: number;
  price: number; // design UI price (used when the live catalog has no price)
  mark: number | null;
  liquidityUsd: number;
  extraCostBps: number; // PreStocks carry a 1% transfer fee
  /** Gross price change to now over 7 / 30 / 90 / 185 days, percent. */
  anchors: [number, number, number, number];
  volDaily: number; // daily volatility for the price path
}

const X = (ticker: string, name: string, mint: string, price: number, anchors: FixtureAsset['anchors'], vol = 0.018, etf = false): FixtureAsset => ({
  ticker,
  name,
  source: 'xStocks',
  assetType: etf ? 'etf' : 'public_stock',
  mint,
  decimals: 8,
  price,
  mark: null,
  liquidityUsd: 600_000,
  extraCostBps: 0,
  anchors,
  volDaily: vol,
});

const P = (ticker: string, name: string, mint: string, price: number, mark: number, anchors: FixtureAsset['anchors']): FixtureAsset => ({
  ticker,
  name,
  source: 'PreStocks',
  assetType: 'pre_ipo',
  mint,
  decimals: 9,
  price,
  mark,
  liquidityUsd: 400_000,
  extraCostBps: 100,
  anchors,
  volDaily: 0.022,
});

const T = (ticker: string, name: string, price: number, mark: number, anchors: FixtureAsset['anchors']): FixtureAsset => ({
  ticker,
  name,
  source: 'Tessera',
  assetType: 'pre_ipo',
  mint: null,
  decimals: 9,
  price,
  mark,
  liquidityUsd: 300_000,
  extraCostBps: 0,
  anchors,
  volDaily: 0.02,
});

export const FIXTURE_ASSETS: FixtureAsset[] = [
  X('NVDAx', 'NVIDIA', 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 184.2, [6, 36, 62, 115], 0.024),
  X('MSFTx', 'Microsoft', 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', 519.8, [2, 11, 19, 34], 0.013),
  X('AAPLx', 'Apple', 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', 258.4, [1, 7, 12, 26], 0.013),
  X('GOOGLx', 'Alphabet', 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 246.1, [1.2, 8, 15, 30], 0.015),
  X('AMZNx', 'Amazon', 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', 231.7, [1, 9, 17, 30], 0.016),
  X('METAx', 'Meta Platforms', 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', 742.3, [1, 10, 17, 32], 0.018),
  X('TSLAx', 'Tesla', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 412.9, [3, 15, 25, 40], 0.03),
  X('PLTRx', 'Palantir', 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', 176.5, [2, 20, 38, 85], 0.028),
  X('COINx', 'Coinbase', 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', 318.55, [-6, 26, 32, 115], 0.04),
  X('HOODx', 'Robinhood', 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', 118.4, [-3, 30, 44, 140], 0.042),
  X('CRCLx', 'Circle', 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', 152.9, [-4, 17, 24, 85], 0.045),
  X('MSTRx', 'Strategy', 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', 344.15, [-2, 12, 20, 60], 0.045),
  X('SPYx', 'S&P 500 ETF', 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', 664.2, [0.5, 4, 8.5, 14], 0.009, true),
  X('QQQx', 'Nasdaq-100 ETF', 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', 601.4, [0.6, 5.5, 10, 17], 0.011, true),
  P('pSPACEX', 'SpaceX', 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh', 119.05, 154.2, [5, 30, 55, 95]),
  P('pOPENAI', 'OpenAI', 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF', 84.6, 96.4, [8, 44, 80, 150]),
  P('pANTHROPIC', 'Anthropic', 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw', 72.15, 88.9, [7, 40, 75, 140]),
  P('pANDURIL', 'Anduril', 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB', 61.3, 70.05, [2, 16, 30, 55]),
  T('tSTRIPE', 'Stripe', 44.8, 51.2, [1, 8, 15, 30]),
  T('tDATABRICKS', 'Databricks', 38.95, 42.6, [1, 6, 12, 25]),
];

export interface FixtureVersion {
  daysAgo: number; // proposal time; activation 24h later
  holdings: [string, number][]; // ticker, weight %
  note: string | null;
}

export interface FixtureBucket {
  key: string;
  name: string;
  creator: { name: string; handle: string };
  thesis: string;
  ageDays: number;
  holders: number;
  backedUsd: number; // design total backed, used to size deposits
  creatorStakeUsd: number;
  prem: number; // design pool premium
  /** v1 recipe at creation, then activated edits. */
  versions: FixtureVersion[];
  pending?: { hoursUntilEffective: number; holdings: [string, number][]; note: string };
}

export const FIXTURE_BUCKETS: FixtureBucket[] = [
  {
    key: 'frontier',
    name: 'Frontier Labs',
    creator: { name: 'Amara Eze', handle: 'amaraonchain' },
    thesis: 'The four companies actually building frontier compute and the models that run on it. Pre-IPO where the upside still is, listed where the earnings are.',
    ageDays: 96,
    holders: 388,
    backedUsd: 1_204_000,
    creatorStakeUsd: 12_000,
    prem: 0.006,
    versions: [
      { daysAgo: 96, holdings: [['NVDAx', 50], ['pOPENAI', 25], ['pSPACEX', 25]], note: null },
      { daysAgo: 64, holdings: [['NVDAx', 30], ['pOPENAI', 25], ['pSPACEX', 25], ['pANTHROPIC', 20]], note: 'Model layer is worth owning directly.' },
      { daysAgo: 19, holdings: [['pOPENAI', 25], ['pANTHROPIC', 25], ['pSPACEX', 25], ['NVDAx', 25]], note: 'Rotating a little further up the risk curve.' },
    ],
    pending: {
      hoursUntilEffective: 18.4,
      holdings: [['pOPENAI', 25], ['pANTHROPIC', 25], ['pSPACEX', 10], ['NVDAx', 25], ['tSTRIPE', 15]],
      note: 'Trimming pSPACEX to fund a position in tSTRIPE.',
    },
  },
  {
    key: 'picks',
    name: 'Picks & Shovels',
    creator: { name: 'Kunle Adeyemi', handle: 'kunlebuilds' },
    thesis: 'Nobody knows which model wins. Everyone knows who sells the compute, the cloud and the deployment layer underneath it.',
    ageDays: 118,
    holders: 214,
    backedUsd: 842_000,
    creatorStakeUsd: 8_000,
    prem: -0.004,
    versions: [
      { daysAgo: 118, holdings: [['NVDAx', 35], ['MSFTx', 25], ['AMZNx', 20], ['PLTRx', 20]], note: null },
      { daysAgo: 80, holdings: [['NVDAx', 35], ['MSFTx', 20], ['AMZNx', 15], ['PLTRx', 15], ['pANTHROPIC', 15]], note: 'Adding the model layer through Anthropic.' },
      { daysAgo: 21, holdings: [['NVDAx', 30], ['MSFTx', 20], ['pANTHROPIC', 20], ['AMZNx', 15], ['PLTRx', 15]], note: 'Taking some NVDA off after the run.' },
    ],
  },
  {
    key: 'crypto',
    name: 'Crypto Equities',
    creator: { name: 'Tobi Bello', handle: 'tobibello' },
    thesis: 'Owning the exchanges, brokers and issuers is a cleaner bet on crypto adoption than owning the coins.',
    ageDays: 142,
    holders: 173,
    backedUsd: 655_000,
    creatorStakeUsd: 5_000,
    prem: 0.011,
    versions: [
      { daysAgo: 142, holdings: [['COINx', 35], ['HOODx', 25], ['MSTRx', 25], ['CRCLx', 15]], note: null },
      { daysAgo: 45, holdings: [['COINx', 30], ['HOODx', 25], ['CRCLx', 25], ['MSTRx', 20]], note: 'More stablecoin exposure through Circle.' },
    ],
  },
  {
    key: 'defense',
    name: 'Defense & Space',
    creator: { name: 'Nneka Okoro', handle: 'nnekaokoro' },
    thesis: 'Autonomy and launch are being rebuilt by three companies, two of which are still private.',
    ageDays: 74,
    holders: 74,
    backedUsd: 288_000,
    creatorStakeUsd: 3_000,
    prem: 0.003,
    versions: [{ daysAgo: 74, holdings: [['pSPACEX', 25], ['pANDURIL', 25], ['PLTRx', 30], ['METAx', 20]], note: null }],
  },
  {
    key: 'boring',
    name: 'Boring Compounders',
    creator: { name: 'Dele Ajayi', handle: 'deleajayi' },
    thesis: 'Four things I will still hold in 2036. Low turnover by design, and I will not touch the weights for a year.',
    ageDays: 165,
    holders: 96,
    backedUsd: 410_000,
    creatorStakeUsd: 10_000,
    prem: -0.002,
    versions: [{ daysAgo: 165, holdings: [['MSFTx', 30], ['AAPLx', 25], ['GOOGLx', 25], ['SPYx', 20]], note: null }],
  },
  {
    key: 'index',
    name: 'Everything Index',
    creator: { name: 'Sade Coker', handle: 'sadecoker' },
    thesis: 'The default bucket. Two broad ETFs and the two largest listed companies, rebalanced never.',
    ageDays: 181,
    holders: 512,
    backedUsd: 1_920_000,
    creatorStakeUsd: 25_000,
    prem: 0.001,
    versions: [{ daysAgo: 181, holdings: [['SPYx', 40], ['QQQx', 30], ['AAPLx', 15], ['MSFTx', 15]], note: null }],
  },
];

/** Share of backers attributed to a share link (design: "64% arrived through a share link"). */
export const FIXTURE_LINK_SHARE = 0.64;
