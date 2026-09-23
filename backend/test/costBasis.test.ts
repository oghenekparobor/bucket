import { describe, expect, it } from 'vitest';
import {
  applyCommissionTokens,
  applyMintFill,
  applyMintRefund,
  applyRedeem,
  applyRedeemProceeds,
  emptyPosition,
  holderView,
  legCostE6,
} from '../src/perf/costBasis.js';

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const tok = (n: number) => BigInt(Math.round(n * 1e6));

describe('average-cost basis', () => {
  it('includes each leg’s share of the mint fee and rent fee in cost', () => {
    // $1,000 mint: $2 fee, $998 net, plus a $0.24 account-rent fee → one leg spending $499 costs half of $1,000.24.
    expect(legCostE6(usd(499), usd(1_000) + usd(0.24), usd(998))).toBe(usd(500.12));
  });

  it('averages cost across mints at different unit prices and releases it pro rata on redeem', () => {
    let p = emptyPosition();
    p = applyMintFill(p, { tokens: tok(10), costE6: usd(1_000) }); // $100/token
    p = applyMintFill(p, { tokens: tok(10), costE6: usd(1_500) }); // $150/token
    expect(p.costE6).toBe(usd(2_500));
    const r = applyRedeem(p, tok(5));
    expect(r.costRemovedE6).toBe(usd(625)); // average $125 × 5
    const after = applyRedeemProceeds(r.position, usd(800));
    expect(after.tokens).toBe(tok(15));
    expect(after.costE6).toBe(usd(1_875));
    expect(after.realizedE6).toBe(usd(175)); // sold for $800 what cost $625
    expect(after.receivedTotalE6).toBe(usd(800));
  });

  it('never removes more tokens than held', () => {
    const p = applyMintFill(emptyPosition(), { tokens: tok(1), costE6: usd(100) });
    const r = applyRedeem(p, tok(5));
    expect(r.position.tokens).toBe(0n);
    expect(r.costRemovedE6).toBe(usd(100));
  });

  it('books the fee on a refunded part of a mint as a realized loss, not basis', () => {
    const p = applyMintFill(emptyPosition(), { tokens: tok(5), costE6: usd(500) });
    const after = applyMintRefund(p, { refundedE6: usd(499), feeE6: usd(2), netE6: usd(998) });
    expect(after.costE6).toBe(usd(500));
    expect(after.realizedE6).toBe(usd(-1));
    expect(after.paidTotalE6).toBe(usd(501));
  });

  it('gives commission tokens zero cost and reports gain against what was paid', () => {
    let p = applyMintFill(emptyPosition(), { tokens: tok(10), costE6: usd(1_000) });
    p = applyCommissionTokens(p, tok(1), usd(120));
    expect(p.costE6).toBe(usd(1_000));
    expect(p.commissionEarnedE6).toBe(usd(120));
    const v = holderView(p, usd(120));
    expect(v.valueE6).toBe(usd(1_320));
    expect(v.gainE6).toBe(usd(320));
    expect(v.gainPct).toBeCloseTo(32, 6);
  });
});
