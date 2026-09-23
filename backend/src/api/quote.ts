/**
 * Mint and redeem quotes (checklist 2.2 "quote both routes and return the cheaper"). Budgets, the unit
 * price after any pending commission, the creator-funding rule and redeem dust come from @bucket/sdk's
 * `math.quoteMint` / `math.quoteRedeem` (exactly what open_mint / redeem will do); each leg then gets its
 * own swap-cost estimate: devnet mock markets charge MOCK_SWAP_FEE_BPS, mainnet costs come from the
 * Jupiter quote probe at the nearest size, plus the asset's issuer transfer-fee allowance. The pool
 * route stays unavailable until each bucket has a Meteora pool.
 */
import { type HoldingState, math } from '@bucket/sdk';
import { type Config, config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { accountRentFeeE6, BPS, DEFAULT_PARAMS, INITIAL_UNIT_PRICE_E6, type ProgramParams } from '../perf/math.js';
import { E6, big, formatE6, roundPct } from '../util/money.js';
import { price, usd } from './views.js';

const DEFAULT_SWAP_COST_BPS = 30;

/** Fee parameters the API quotes with (Config values; commission terms are fixed by the spec). */
export function programParams(cfg: Pick<Config, 'MINT_FEE_BPS' | 'REDEEM_FEE_BPS'>): ProgramParams {
  return { ...DEFAULT_PARAMS, mintFeeBps: cfg.MINT_FEE_BPS, redeemFeeBps: cfg.REDEEM_FEE_BPS };
}

export interface QuoteHolding {
  mint: string;
  ticker: string;
  weightBps: number;
  decimals: number;
  available: bigint;
  priceE6: bigint;
  extraCostBps: number;
  isMock: boolean;
  minTradeUsd: number | null;
  probe: { usd: number; ok: boolean; deviationPct: number | null; priceImpactPct: number | null }[] | null;
}

export interface QuoteContext {
  status: 'open' | 'closed';
  supply: bigint;
  hwmE6: bigint;
  /** A creator mint order has filled completely; until then only the creator can mint. */
  creatorFunded: boolean;
  holdings: QuoteHolding[];
  solUsd: number | null;
  poolPriceE6: bigint | null;
}

/** Estimated all-in swap cost of trading `sizeUsd` of a holding, in bps. */
export function legCostBps(h: QuoteHolding, sizeUsd: number, mockFeeBps = config.MOCK_SWAP_FEE_BPS): number {
  if (h.isMock) return mockFeeBps + h.extraCostBps;
  const samples = (h.probe ?? []).filter((s) => s.ok && s.deviationPct !== null).sort((a, b) => a.usd - b.usd);
  if (samples.length === 0) return DEFAULT_SWAP_COST_BPS + h.extraCostBps;
  const at = samples.find((s) => s.usd >= sizeUsd) ?? samples.at(-1)!;
  return Math.max(0, Math.round(-at.deviationPct! * 100)) + h.extraCostBps;
}

interface Route {
  kind: 'mint' | 'pool';
  available: boolean;
  reason: string | null;
  tokensOut?: string;
  usdcOut?: string;
  effectivePrice: string | null;
  effectiveVsUnitPct: number | null;
  costUsd: string | null;
}

/** One-time account rent a first-time backer repays in USDC (capped at $1 on-chain); null if SOL is unpriced. */
const rentUsd = (solUsd: number | null) => (solUsd === null ? null : usd(accountRentFeeE6(solUsd)));

const holdingStates = (ctx: QuoteContext): HoldingState[] =>
  ctx.holdings.map((h) => ({ mint: h.mint, decimals: h.decimals, weightBps: h.weightBps, balance: h.available, reserved: 0n, priceE6: h.priceE6, twapE6: h.priceE6 }));

const choose = (routes: Route[], better: (a: Route, b: Route) => boolean) =>
  routes.filter((r) => r.available).reduce<Route | null>((best, r) => (best === null || better(r, best) ? r : best), null)?.kind ?? null;

function poolRoute(ctx: QuoteContext, field: 'tokensOut' | 'usdcOut'): Route {
  return {
    kind: 'pool',
    available: false,
    reason: ctx.poolPriceE6 === null ? 'no_pool' : 'pool_quotes_not_supported',
    [field]: '0',
    effectivePrice: ctx.poolPriceE6 === null ? null : price(ctx.poolPriceE6),
    effectiveVsUnitPct: null,
    costUsd: null,
  };
}

export function quoteMint(ctx: QuoteContext, amountE6: bigint, params: ProgramParams = DEFAULT_PARAMS) {
  const q = math.quoteMint({
    amountE6,
    holdings: holdingStates(ctx),
    supply: ctx.supply,
    hwmE6: ctx.hwmE6,
    commissionBps: params.commissionBps,
    mintFeeBps: params.mintFeeBps,
    swapCostBps: 0,
    creatorFunded: ctx.creatorFunded,
  });
  const unit = q.unitPriceE6 || INITIAL_UNIT_PRICE_E6;
  let tokensOut = 0n;
  const legs = q.legs.map((l, i) => {
    const h = ctx.holdings[i]!;
    const cost = legCostBps(h, Number(l.budgetE6) / 1e6);
    tokensOut += (((l.budgetE6 * (BPS - BigInt(cost))) / BPS) * E6) / unit;
    return { mint: h.mint, ticker: h.ticker, weightPct: h.weightBps / 100, amountUsd: usd(l.budgetE6), estCostPct: cost / 100, tooSmall: h.minTradeUsd !== null && Number(l.budgetE6) / 1e6 < h.minTradeUsd };
  });

  const minimum = BigInt(Math.round((ctx.creatorFunded ? config.MIN_DEPOSIT_USD : config.MIN_CREATOR_DEPOSIT_USD) * 1e6));
  const reason =
    ctx.status !== 'open' ? 'bucket_closed' : amountE6 < minimum ? 'below_minimum' : legs.some((l) => l.tooSmall) ? 'leg_below_min_trade' : null;
  const effective = tokensOut > 0n ? (amountE6 * E6) / tokensOut : null;
  const mint: Route = {
    kind: 'mint',
    available: reason === null && tokensOut > 0n,
    reason,
    tokensOut: tokensOut.toString(),
    effectivePrice: effective === null ? null : price(effective),
    effectiveVsUnitPct: effective === null ? null : roundPct((Number(effective) / Number(unit) - 1) * 100),
    costUsd: usd(amountE6 - (tokensOut * unit) / E6),
  };
  const routes = [mint, poolRoute(ctx, 'tokensOut')];
  return {
    routes,
    chosen: choose(routes, (a, b) => big(a.tokensOut) > big(b.tokensOut)),
    feeUsd: usd(q.feeE6),
    rentUsd: rentUsd(ctx.solUsd),
    legs: legs.map(({ tooSmall: _t, ...l }) => l),
    unitPrice: price(unit),
  };
}

export function quoteRedeem(ctx: QuoteContext, tokens: bigint, params: ProgramParams = DEFAULT_PARAMS) {
  const q = math.quoteRedeem({
    tokens,
    holdings: holdingStates(ctx),
    supply: ctx.supply,
    hwmE6: ctx.hwmE6,
    commissionBps: params.commissionBps,
    redeemFeeBps: params.redeemFeeBps,
    swapCostBps: 0,
  });
  const unit = q.unitPriceE6;
  let usdcOut = 0n;
  const legs = q.legs.map((l, i) => {
    const h = ctx.holdings[i]!;
    const cost = legCostBps(h, Number(l.valueE6) / 1e6);
    usdcOut += (l.valueE6 * (BPS - BigInt(cost))) / BPS;
    return { mint: h.mint, ticker: h.ticker, weightPct: h.weightBps / 100, qty: l.qty.toString(), valueUsd: usd(l.valueE6), estCostPct: cost / 100 };
  });
  const reason = ctx.supply === 0n || tokens > ctx.supply ? 'exceeds_supply' : tokens <= 0n ? 'zero_tokens' : null;
  const effective = tokens > 0n ? (usdcOut * E6) / tokens : null;
  const mint: Route = {
    kind: 'mint',
    available: reason === null,
    reason,
    usdcOut: formatE6(usdcOut, 2),
    effectivePrice: effective === null ? null : price(effective),
    effectiveVsUnitPct: effective === null || unit === 0n ? null : roundPct((Number(effective) / Number(unit) - 1) * 100),
    costUsd: usd((tokens * unit) / E6 - usdcOut),
  };
  const routes = [mint, poolRoute(ctx, 'usdcOut')];
  return {
    routes,
    chosen: choose(routes, (a, b) => Number(a.usdcOut) > Number(b.usdcOut)),
    feeUsd: usd((q.feeTokens * unit) / E6),
    rentUsd: null,
    legs,
    unitPrice: price(unit),
  };
}

export async function loadQuoteContext(db: Queryable, address: string): Promise<QuoteContext | null> {
  const [b, holdings, sol, pool] = await Promise.all([
    db.query(`SELECT status, supply, hwm_e6, creator_funded FROM buckets WHERE address = $1`, [address]),
    db.query(
      `SELECT h.mint, h.weight_bps, a.ticker, a.decimals, COALESCE(a.extra_cost_bps, 0) AS extra_cost_bps,
         (a.mirror_of IS NOT NULL OR (a.program_listed AND a.source_payload IS NULL)) AS is_mock,
         COALESCE(a.min_trade_usd, mm.min_trade_usd) AS min_trade_usd, COALESCE(a.probe, mm.probe) AS probe,
         COALESCE(v.balance, 0) - COALESCE(v.reserved, 0) AS available,
         (SELECT p.price_e6 FROM asset_prices p WHERE p.mint = h.mint AND p.kind IN ('onchain', 'program') ORDER BY p.ts DESC LIMIT 1) AS price_e6
       FROM holdings h JOIN assets a ON a.mint = h.mint LEFT JOIN assets mm ON mm.mint = a.mirror_of
       LEFT JOIN vault_balances v ON v.bucket = h.bucket AND v.mint = h.mint
       WHERE h.bucket = $1 ORDER BY h.position`,
      [address],
    ),
    db.query(`SELECT value FROM kv WHERE key = 'sol_price_usd'`),
    db.query(`SELECT price_e6 FROM pool_prices WHERE bucket = $1 AND ts > now() - interval '1 hour' ORDER BY ts DESC LIMIT 1`, [address]),
  ]);
  const row = b.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    supply: big(row.supply),
    hwmE6: big(row.hwm_e6),
    creatorFunded: row.creator_funded,
    holdings: holdings.rows.map((h) => ({
      mint: h.mint,
      ticker: h.ticker,
      weightBps: h.weight_bps,
      decimals: h.decimals,
      available: big(h.available),
      priceE6: h.price_e6 === null ? 0n : big(h.price_e6),
      extraCostBps: Number(h.extra_cost_bps),
      isMock: h.is_mock,
      minTradeUsd: h.min_trade_usd === null ? null : Number(h.min_trade_usd),
      probe: h.probe,
    })),
    solUsd: sol.rows[0] ? Number(sol.rows[0].value) : null,
    poolPriceE6: pool.rows[0] ? big(pool.rows[0].price_e6) : null,
  };
}
