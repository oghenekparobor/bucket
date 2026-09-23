/**
 * Holder cost basis, average-cost method.
 *
 * - A mint fill adds the tokens issued and their cost: the USDC spent on that leg plus the leg's pro-rata
 *   share of the fees (`usdc_spent × paid / net`, where paid = amount_e6 + rent_fee_e6: the 0.20% mint
 *   fee and any one-time account-rent fee are costs of holding, not money invested).
 * - When a mint order closes with a refund, the fees charged on the refunded (never invested) part are a
 *   realized loss, not cost basis, because no tokens were bought with them.
 * - A redeem removes tokens at the current average cost (cost × removed / held); proceeds (USDC from
 *   fills, or the in-kind value of claimed tokens at claim time) are realized P&L.
 * - Commission tokens a creator receives carry zero cost; their value at issue is tracked separately as
 *   commission earned, and every holder's dilution from a settlement is tracked as commission paid.
 * - Only flows through the program are seen. Bucket tokens moved by plain SPL transfers or bought in a
 *   pool are not in any event, so "what they paid through Bucket" is exactly what this measures.
 */
import { E6 } from '../util/money.js';

export interface PositionState {
  tokens: bigint;
  costE6: bigint;
  realizedE6: bigint;
  paidTotalE6: bigint;
  receivedTotalE6: bigint;
  commissionPaidE6: bigint;
  commissionEarnedE6: bigint;
}

export const emptyPosition = (): PositionState => ({
  tokens: 0n,
  costE6: 0n,
  realizedE6: 0n,
  paidTotalE6: 0n,
  receivedTotalE6: 0n,
  commissionPaidE6: 0n,
  commissionEarnedE6: 0n,
});

/** Cost of one mint leg including its share of the order's fees (`orderPaidE6` = amount + rent fee). */
export function legCostE6(usdcSpentE6: bigint, orderPaidE6: bigint, orderNetE6: bigint): bigint {
  if (orderNetE6 <= 0n) return usdcSpentE6;
  return (usdcSpentE6 * orderPaidE6) / orderNetE6;
}

export function applyMintFill(p: PositionState, fill: { tokens: bigint; costE6: bigint }): PositionState {
  return {
    ...p,
    tokens: p.tokens + fill.tokens,
    costE6: p.costE6 + fill.costE6,
    paidTotalE6: p.paidTotalE6 + fill.costE6,
  };
}

/** Fee paid on the refunded part of a mint order becomes a realized loss. */
export function applyMintRefund(p: PositionState, o: { refundedE6: bigint; feeE6: bigint; netE6: bigint }): PositionState {
  if (o.refundedE6 <= 0n || o.netE6 <= 0n) return p;
  const lostFee = (o.feeE6 * o.refundedE6) / o.netE6;
  return { ...p, realizedE6: p.realizedE6 - lostFee, paidTotalE6: p.paidTotalE6 + lostFee };
}

/** Removes tokens at average cost. Returns the new state and the cost basis released. */
export function applyRedeem(p: PositionState, tokensOut: bigint): { position: PositionState; costRemovedE6: bigint } {
  const removed = tokensOut > p.tokens ? p.tokens : tokensOut;
  const costRemovedE6 = p.tokens > 0n ? (p.costE6 * removed) / p.tokens : 0n;
  return {
    position: { ...p, tokens: p.tokens - removed, costE6: p.costE6 - costRemovedE6, realizedE6: p.realizedE6 - costRemovedE6 },
    costRemovedE6,
  };
}

/** USDC received from a redeem fill, or the value of tokens claimed in kind. */
export function applyRedeemProceeds(p: PositionState, proceedsE6: bigint): PositionState {
  return { ...p, realizedE6: p.realizedE6 + proceedsE6, receivedTotalE6: p.receivedTotalE6 + proceedsE6 };
}

export function applyCommissionTokens(p: PositionState, tokens: bigint, valueE6: bigint): PositionState {
  return { ...p, tokens: p.tokens + tokens, commissionEarnedE6: p.commissionEarnedE6 + valueE6 };
}

export interface HolderView {
  valueE6: bigint;
  paidE6: bigint;
  gainE6: bigint;
  gainPct: number | null;
}

/** Current value against what the held tokens cost through Bucket. */
export function holderView(p: PositionState, unitPriceE6: bigint): HolderView {
  const valueE6 = (p.tokens * unitPriceE6) / E6;
  const gainE6 = valueE6 - p.costE6;
  return {
    valueE6,
    paidE6: p.costE6,
    gainE6,
    gainPct: p.costE6 > 0n ? (Number(gainE6) / Number(p.costE6)) * 100 : null,
  };
}
