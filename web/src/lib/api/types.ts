/**
 * API shapes from docs/architecture.md §3. USD values are decimal strings, percents are numbers
 * (31.4 = 31.4%), addresses are base58. Anything marked ASSUMED is not pinned down by the contract
 * and is documented in web/README.md.
 */

export type Source = 'xStocks' | 'PreStocks' | 'Tessera';
export type AssetType = 'public_stock' | 'etf' | 'pre_ipo';
export type Period = '7d' | '30d' | '90d' | 'all';
export const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];
export const PERIOD_LABEL: Record<Period, string> = { '7d': '7D', '30d': '30D', '90d': '90D', all: 'ALL' };

export interface CatalogToken {
  mint: string;
  ticker: string;
  name: string;
  source: Source;
  assetType: AssetType;
  price: string;
  markPrice: string | null;
  liquidityUsd: string | null;
  decimals: number;
  logo: string | null;
  eligible: boolean;
  /** Why not eligible: below_liquidity_floor, no_price, no_route, flagged, disabled_on_chain, issuer_* … */
  eligibilityReason: string | null;
  flagged: boolean;
  maxWeightPct: number;
}

export interface CreatorRef {
  wallet: string;
  displayName: string | null;
  xHandle: string | null;
  xVerified: boolean;
}

export interface BucketSummary {
  address: string;
  slug: string;
  name: string;
  creator: CreatorRef;
  status: 'open' | 'closed';
  unitPrice: string;
  returns: Record<Period, number | null>;
  maxDrawdown: number;
  totalBacked: string;
  holders: number;
  ageDays: number;
  topHoldings: { ticker: string; weightPct: number }[];
  eligible: boolean;
  /**
   * 'awaiting_creator' while the creator's first order has not fully filled: the program blocks
   * other backers until it does. Optional (not yet in architecture §3).
   */
  fundingState?: 'awaiting_creator' | 'funded' | null;
}

export interface Holding {
  mint: string;
  ticker: string;
  name: string;
  source: Source;
  assetType: AssetType;
  weightPct: number;
  price: string;
  markPrice: string | null;
  markGapPct: number | null;
  contributionPct: number | null;
  balance: string;
  valueUsd: string;
}

export interface BucketVersion {
  version: number;
  activatedAt: string;
  holdings: { ticker: string; weightPct: number }[];
  note: string | null;
  changeSummary: string;
}

export interface PendingEdit {
  version: number;
  effectiveAt: string;
  note: string | null;
  diff: { ticker: string; fromPct: number | null; toPct: number | null }[];
}

export interface BucketDetail extends BucketSummary {
  thesis: string;
  createdAt: string;
  version: number;
  tokenMint: string;
  vault: string;
  supply: string;
  hwm: string;
  poolPrice: string | null;
  premiumPct: number | null;
  holdings: Holding[];
  preIpoSharePct: number;
  versions: BucketVersion[];
  pendingEdit: PendingEdit | null;
  lastSettledAt: string | null;
  eventCount: number;
  shareUrl: string;
}

export interface Health {
  ok: boolean;
  cluster: string;
  programId: string;
  lastSync: string | null;
}

export interface CatalogResponse {
  tokens: CatalogToken[];
  syncedAt: string;
}

export interface Stats {
  totalBacked: string;
  bucketCount: number;
  backers: number;
  commissionPaid: string;
  creatorsPaid: number;
  medianPoolGapPct: number;
  shareLinkBackerPct: number;
}

export interface LeaderboardRow extends BucketSummary {
  rank: number;
  return: number | null;
  spark: number[];
}

export interface Leaderboard {
  period: Period;
  updatedAt: string;
  rows: LeaderboardRow[];
}

export interface ChartPoint {
  t: string;
  unitPrice: number;
  hwm: number;
}

export interface Chart {
  points: ChartPoint[];
}

/** ASSUMED: `totals` is not specified beyond its name. Every field is optional on read. */
export interface CreatorTotals {
  totalBacked?: string;
  bucketCount?: number;
  openBuckets?: number;
  holders?: number;
  commissionEarned?: string;
}

export interface CreatorProfile {
  creator: CreatorRef;
  buckets: BucketSummary[];
  totals: CreatorTotals;
}

export type RouteKind = 'mint' | 'pool';

/** ASSUMED: leg entries carry ticker, weight and the USD budget (mint) or quantity (redeem). */
export interface QuoteLeg {
  ticker: string;
  weightPct: number;
  usd?: string;
  qty?: string;
}

/** Route quote. Nullable fields are null when the route cannot be priced (see `reason`). */
export interface MintQuoteRoute {
  kind: RouteKind;
  available: boolean;
  reason?: string | null;
  /** Bucket tokens out, decimal string (the live client converts from raw base units). */
  tokensOut: string;
  effectivePrice: string | null;
  effectiveVsUnitPct: number | null;
  costUsd: string | null;
}

export interface MintQuote {
  routes: MintQuoteRoute[];
  /** Null when no route is available. */
  chosen: RouteKind | null;
  feeUsd: string;
  rentUsd: string | null;
  legs: QuoteLeg[];
  unitPrice: string;
}

export interface RedeemQuoteRoute {
  kind: RouteKind;
  available: boolean;
  reason?: string | null;
  usdcOut: string;
  effectivePrice: string | null;
  effectiveVsUnitPct: number | null;
  costUsd: string | null;
}

export interface RedeemQuote {
  routes: RedeemQuoteRoute[];
  chosen: RouteKind | null;
  feeUsd: string;
  rentUsd: string | null;
  legs: QuoteLeg[];
  unitPrice: string;
}

export type LegStatus = 'queued' | 'swapping' | 'filled' | 'failed' | 'claimed';
export type OrderStatus = 'open' | 'filling' | 'done' | 'refunded';

export interface Order {
  kind: 'mint' | 'redeem';
  status: OrderStatus;
  legs: { ticker: string; weightPct: number; status: LegStatus }[];
  /** Bucket tokens issued (mint) or burned (redeem), as a decimal string. */
  tokens: string;
  /** USDC spent (mint) or paid out (redeem), as a decimal string. */
  usdc: string;
}

export interface Me {
  userId: string;
  wallet: string;
  email: string | null;
  xHandle: string | null;
  xVerified: boolean;
  telegramChatId?: string | null;
  /** Null when the balance lookup failed (RPC timeout). */
  usdcBalance: string | null;
  solBalance: string | null;
}

export interface Position {
  bucket: BucketSummary;
  tokens: string;
  unitPrice: string;
  value: string;
  paid: string;
  gainUsd: string;
  gainPct: number | null;
}

export interface Portfolio {
  positions: Position[];
  totals: { value: string; paid: string; gainUsd: string; gainPct: number | null; commissionPaid: string };
}

/**
 * GET /v1/me/dashboard. The contract only says "creator dashboard (backers by day, commission,
 * funnel, own buckets)"; this is the shape backend/src/api/routes/me.ts returns. The web derives the
 * rest (leaderboard rank, high-water mark, unpaid commission) from public endpoints.
 */
export interface Dashboard {
  buckets: BucketSummary[];
  backersByDay: {
    day: string;
    newBackers: number;
    depositsUsd?: string;
    /** Optional: days the creator shared the link on X (yellow bars in the design). Not sent by the backend yet. */
    shared?: boolean;
  }[];
  commission: {
    grossUsd: string;
    platformShareUsd: string;
    creatorShareUsd: string;
    lastSettlement: { at: string; amountUsd: string } | null;
  };
  funnel: { linkClicks: number; uniqueVisitors: number; signedInFromLink: number; deposited: number };
}

export interface CreateBucketBody {
  name: string;
  thesis: string;
  holdings: { mint: string; weightPct: number }[];
  stakeUsd: string;
}

export interface CreateBucketResult {
  transactions: string[];
  bucket: string;
  slug: string;
  /** The creator's first mint order, when the backend returns it (fills like any mint). */
  order?: string | null;
  /** Indices of transactions that may fail without failing the publish (token metadata; the keeper backfills it). */
  optional?: number[];
}

export interface TxResult {
  transaction: string;
}

export interface OrderTxResult extends TxResult {
  /** Order PDA to poll. ASSUMED null when the pool route was chosen (no fill legs). */
  order: string | null;
}

export interface SubmitResult {
  signature: string;
}
