import { describe, expect, it } from 'vitest';
import {
  accountRentFeeE6,
  INITIAL_UNIT_PRICE_E6,
  MAX_RENT_FEE_E6,
  redeemShares,
  settleCommission,
  splitMint,
  tokensForValue,
  unitPrice,
  valueVault,
} from '../src/perf/math.js';
import { formatE6, usdToE6, valueE6 } from '../src/util/money.js';

const usd = (n: number) => BigInt(Math.round(n * 1e6));
const tokens = (n: number) => BigInt(Math.round(n * 1e6));

describe('commission (product-v2 worked example)', () => {
  // Launch: $100,000 vault, 1,000 tokens, unit $100, high-water mark $100.
  const supply0 = tokens(1_000);

  it('stocks rise 25%: $5,000 commission, $4,000 creator / $1,000 platform, unit 125 → 120, supply 1,041.67', () => {
    const vault = usd(125_000);
    expect(unitPrice(vault, supply0)).toBe(usd(125));
    const s = settleCommission({ vaultValueE6: vault, supply: supply0, hwmE6: INITIAL_UNIT_PRICE_E6 })!;
    expect(s.commissionE6).toBe(usd(5_000));
    expect(formatE6(s.supplyAfter, 2)).toBe('1041.67');
    expect(formatE6(unitPrice(vault, s.supplyAfter)!, 2)).toBe('120.00');
    expect(formatE6(s.hwmAfterE6, 2)).toBe('120.00');
    // Fee tokens valued at the post-fee unit price: $4,000 to the creator, $1,000 to the platform.
    expect(Math.round(Number(s.creatorTokens * s.hwmAfterE6) / 1e12)).toBe(4_000);
    expect(Math.round(Number(s.platformTokens * s.hwmAfterE6) / 1e12)).toBe(1_000);
    expect(s.creatorTokens + s.platformTokens).toBe(s.feeTokens);
  });

  it('stocks fall 10%: unit $108, below the $120 mark, nothing owed', () => {
    const first = settleCommission({ vaultValueE6: usd(125_000), supply: supply0, hwmE6: INITIAL_UNIT_PRICE_E6 })!;
    const vault = usd(112_500);
    expect(formatE6(unitPrice(vault, first.supplyAfter)!, 2)).toBe('108.00');
    expect(settleCommission({ vaultValueE6: vault, supply: first.supplyAfter, hwmE6: first.hwmAfterE6 })).toBeNull();
  });

  it('stocks recover to $130: $2,083 commission ($1,667 / $417), unit → 128, supply 1,057.94; holder up 28%', () => {
    const first = settleCommission({ vaultValueE6: usd(125_000), supply: supply0, hwmE6: INITIAL_UNIT_PRICE_E6 })!;
    const vault = (usd(130) * first.supplyAfter) / 1_000_000n;
    const s = settleCommission({ vaultValueE6: vault, supply: first.supplyAfter, hwmE6: first.hwmAfterE6 })!;
    expect(Math.round(Number(s.commissionE6) / 1e6)).toBe(2_083);
    expect(Math.round(Number(s.creatorTokens * s.hwmAfterE6) / 1e12)).toBe(1_667);
    expect(Math.round(Number(s.platformTokens * s.hwmAfterE6) / 1e12)).toBe(417);
    expect(formatE6(s.supplyAfter, 2)).toBe('1057.94');
    expect(formatE6(s.hwmAfterE6, 2)).toBe('128.00');
    // A holder from launch: $100 → $128 per token.
    expect(Number(s.hwmAfterE6) / Number(INITIAL_UNIT_PRICE_E6) - 1).toBeCloseTo(0.28, 4);
  });

  it('owes nothing at or below the mark, or with no supply', () => {
    expect(settleCommission({ vaultValueE6: usd(100_000), supply: supply0, hwmE6: usd(100) })).toBeNull();
    expect(settleCommission({ vaultValueE6: usd(1), supply: 0n, hwmE6: usd(100) })).toBeNull();
  });
});

describe('mint and redeem math', () => {
  it('takes the 0.20% fee and splits by target weights while supply is 0', () => {
    const s = splitMint(usd(1_000), [
      { mint: 'A', valueE6: 0n, weightBps: 5_000 },
      { mint: 'B', valueE6: 0n, weightBps: 3_000 },
      { mint: 'C', valueE6: 0n, weightBps: 2_000 },
    ], 0n);
    expect(s.feeE6).toBe(usd(2));
    expect(s.netE6).toBe(usd(998));
    expect(s.budgets.map((b) => b.budgetE6)).toEqual([usd(499), usd(299.4), usd(199.6)]);
  });

  it('splits by current vault value once tokens exist, rounding dust to the largest leg', () => {
    const s = splitMint(100n, [
      { mint: 'A', valueE6: 1n, weightBps: 5_000 },
      { mint: 'B', valueE6: 2n, weightBps: 5_000 },
    ], 10n, { commissionBps: 2000, platformShareBps: 2000, mintFeeBps: 0, redeemFeeBps: 0 });
    expect(s.budgets.reduce((a, b) => a + b.budgetE6, 0n)).toBe(100n);
    expect(s.budgets[1]!.budgetE6).toBe(67n);
  });

  it('values raw quantities at per-raw-token prices and issues tokens at the snapshot unit price', () => {
    // 0.5 whole tokens of an 8-decimal mint at $200 = $100.
    expect(valueE6(50_000_000n, usd(200), 8)).toBe(usd(100));
    expect(valueVault([{ mint: 'A', available: 50_000_000n, priceE6: usd(200), decimals: 8 }])).toBe(usd(100));
    expect(tokensForValue(usd(250), usd(125))).toBe(tokens(2));
  });

  it('reserves floor(available × tokens / supply) of each holding on redeem', () => {
    expect(redeemShares([{ mint: 'A', available: 1_000n }, { mint: 'B', available: 7n }], 1n, 3n)).toEqual([
      { mint: 'A', qty: 333n },
      { mint: 'B', qty: 2n },
    ]);
  });

  it('charges a new backer the account rent in USDC, capped at $1', () => {
    expect(accountRentFeeE6(120)).toBe(244_713n); // 0.00203928 SOL × $120
    expect(accountRentFeeE6(1_000)).toBe(MAX_RENT_FEE_E6);
    expect(accountRentFeeE6(null)).toBe(0n);
  });
});

describe('money formatting', () => {
  it('round-trips decimal strings and rounds half away from zero', () => {
    expect(usdToE6('1250.50')).toBe(1_250_500_000n);
    expect(usdToE6('0.0000005')).toBe(1n);
    expect(formatE6(1_250_500_000n, 2)).toBe('1250.50');
    expect(formatE6(-1_005_000n, 2)).toBe('-1.01');
    expect(formatE6(123_456_789n, 6)).toBe('123.456789');
  });
});
