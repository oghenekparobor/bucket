import { describe, expect, it } from 'vitest';
import { catalogEligibility, maxWeightPct } from '../src/catalog/eligibility.js';
import { checkEligibility, minCreatorStakeUsd } from '../src/perf/eligibility.js';
import { validateRecipe } from '../src/buckets/rules.js';
import { DAY_MS, HOUR_MS } from '../src/util/time.js';

const now = 1_000 * DAY_MS;
const base = { period: '30d' as const, nowMs: now, createdAtMs: now - 60 * DAY_MS, status: 'open' as const, creatorMinStakeUsd: 30, illiquidHoldings: [] };

describe('leaderboard eligibility (phase 2 rules)', () => {
  it('accepts a bucket that meets every rule', () => {
    expect(checkEligibility(base)).toEqual({ eligible: true, reasons: [] });
  });

  it('needs 14 days and at least the period length', () => {
    expect(checkEligibility({ ...base, createdAtMs: now - 10 * DAY_MS }).reasons).toEqual(['too_new', 'younger_than_period']);
    expect(checkEligibility({ ...base, period: '90d' }).reasons).toEqual(['younger_than_period']);
    expect(checkEligibility({ ...base, period: 'all', createdAtMs: now - 15 * DAY_MS }).eligible).toBe(true);
  });

  it('needs the creator’s $25 held continuously, liquid holdings, and an open bucket', () => {
    expect(checkEligibility({ ...base, creatorMinStakeUsd: 24.99 }).reasons).toEqual(['creator_stake']);
    expect(checkEligibility({ ...base, creatorMinStakeUsd: null }).reasons).toEqual(['creator_stake']);
    expect(checkEligibility({ ...base, illiquidHoldings: ['pSPACEX'] }).reasons).toEqual(['illiquid_holding']);
    expect(checkEligibility({ ...base, status: 'closed' }).reasons).toEqual(['closed']);
  });

  it('tracks the creator’s lowest stake value over the window, from their first mint', () => {
    const units = [0, 1, 2, 3, 4].map((h) => ({ t: h * HOUR_MS, u: [100, 100, 90, 110, 120][h]! }));
    const tokens = [
      { t: 1 * HOUR_MS, tokens: 300_000n }, // 0.3 tokens = $30
      { t: 3 * HOUR_MS, tokens: 200_000n }, // sold down to 0.2 = $22
    ];
    expect(minCreatorStakeUsd(units, tokens, 0)).toBeCloseTo(22, 6);
    expect(minCreatorStakeUsd(units, tokens.slice(0, 1), 0)).toBeCloseTo(27, 6); // price dip to 90
    expect(minCreatorStakeUsd(units, [], 0)).toBeNull();
  });
});

describe('catalog eligibility and recipe rules', () => {
  const rules = { floorUsd: 250_000, requireQuoteProbe: false, maxMinTradeUsd: 1 };

  it('applies the liquidity floor, flags and price requirement', () => {
    expect(catalogEligibility({ flagged: false, hasPrice: true, liquidityUsd: 250_000, minTradeUsd: null }, rules).eligible).toBe(true);
    expect(catalogEligibility({ flagged: false, hasPrice: true, liquidityUsd: 249_999, minTradeUsd: null }, rules).reasons).toEqual(['below_liquidity_floor']);
    expect(catalogEligibility({ flagged: true, hasPrice: false, liquidityUsd: null, minTradeUsd: null }, rules).reasons).toEqual(['flagged', 'no_price', 'below_liquidity_floor']);
    expect(catalogEligibility({ flagged: false, hasPrice: true, liquidityUsd: 1e6, minTradeUsd: 10 }, { ...rules, requireQuoteProbe: true }).reasons).toEqual(['no_route']);
  });

  it('caps pre-IPO weights at 25% and public stocks at 50%', () => {
    expect(maxWeightPct('pre_ipo')).toBe(25);
    expect(maxWeightPct('etf')).toBe(50);
  });

  it('validates recipes like the program', () => {
    const assets = new Map([
      ['A', { ticker: 'NVDAx', assetType: 'public_stock', eligible: true, flagged: false }],
      ['B', { ticker: 'pSPACEX', assetType: 'pre_ipo', eligible: true, flagged: false }],
      ['C', { ticker: 'KOx', assetType: 'public_stock', eligible: false, flagged: false }],
      ['D', { ticker: 'OLDx', assetType: 'public_stock', eligible: false, flagged: true }],
    ]);
    expect(validateRecipe([{ mint: 'A', weightPct: 75 }, { mint: 'B', weightPct: 25 }], assets)).toEqual(['NVDAx: weight must be 2% to 50%']);
    expect(validateRecipe([{ mint: 'A', weightPct: 50 }, { mint: 'B', weightPct: 50 }], assets)).toEqual(['pSPACEX: weight must be 2% to 25%']);
    expect(validateRecipe([{ mint: 'A', weightPct: 50 }, { mint: 'C', weightPct: 40 }], assets)).toEqual([
      'KOx is below the liquidity floor',
      'Weights must sum to 100% (got 90%)',
    ]);
    expect(validateRecipe([{ mint: 'A', weightPct: 100 }], assets)[0]).toMatch(/2 to 15 tokens/);
    expect(validateRecipe([{ mint: 'A', weightPct: 50 }, { mint: 'D', weightPct: 50 }], assets)).toEqual(['OLDx is flagged for review and cannot be added']);
    expect(validateRecipe([{ mint: 'A', weightPct: 50 }, { mint: 'B', weightPct: 25 }, { mint: 'B', weightPct: 25 }], assets)).toContain('Each token can appear once');
  });
});
