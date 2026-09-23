import { describe, expect, it } from 'vitest';
import { fromPreStock, fromTessera, fromXStock } from '../src/catalog/classify.js';
import { MISSING_REASON, planCatalogMerge, type ExistingAsset } from '../src/catalog/merge.js';
import { rawPrice } from '../src/catalog/sources/jupiter.js';
import type { SourceToken } from '../src/catalog/types.js';

const token = (mint: string, source: SourceToken['source'] = 'xStocks'): SourceToken => ({
  mint,
  ticker: mint,
  name: mint,
  source,
  assetType: 'public_stock',
  decimals: 8,
  tokenProgram: null,
  logo: null,
  sector: null,
  uiPrice: 1,
  markPrice: null,
  liquidityUsd: 1,
  holders: null,
  payload: {},
});
const existing = (mint: string, over: Partial<ExistingAsset> = {}): ExistingAsset => ({
  mint,
  ticker: mint,
  source: 'xStocks',
  flagged: false,
  flagReason: null,
  fixture: false,
  ...over,
});

describe('catalog merge', () => {
  it('flags a token that disappears from a successful fetch and never drops it', () => {
    const plan = planCatalogMerge([existing('A'), existing('B'), existing('C')], [{ source: 'xStocks', ok: true, tokens: [token('A'), token('B')] }]);
    expect(plan.flag).toEqual([{ mint: 'C', reason: MISSING_REASON }]);
    expect(plan.upserts.map((t) => t.mint)).toEqual(['A', 'B']);
  });

  it('clears a disappearance flag when the token comes back, but not a manual flag', () => {
    const plan = planCatalogMerge(
      [existing('A', { flagged: true, flagReason: MISSING_REASON }), existing('B', { flagged: true, flagReason: 'manual_review' })],
      [{ source: 'xStocks', ok: true, tokens: [token('A'), token('B')] }],
    );
    expect(plan.unflag).toEqual(['A']);
  });

  it('never flags on a failed or suspiciously partial fetch, or for other sources and fixtures', () => {
    const known = ['A', 'B', 'C', 'D'].map((m) => existing(m));
    expect(planCatalogMerge(known, [{ source: 'xStocks', ok: false, tokens: [] }]).flag).toEqual([]);
    const partial = planCatalogMerge(known, [{ source: 'xStocks', ok: true, tokens: [token('A')] }]);
    expect(partial.flag).toEqual([]);
    expect(partial.partialSources).toEqual(['xStocks']);
    const other = planCatalogMerge([existing('P', { source: 'PreStocks' }), existing('F', { fixture: true })], [{ source: 'xStocks', ok: true, tokens: [token('A')] }]);
    expect(other.flag).toEqual([]);
  });
});

describe('issuer field mapping', () => {
  it('maps a PreStocks entry (p-prefixed ticker, mark price, Jupiter metadata)', () => {
    const t = fromPreStock(
      { name: 'SpaceX PreStocks', symbol: 'SPACEX', contract_address: 'PreAN', markPrice: 151.83, tokenPrice: 121.63, supply: 43712, image: 'x.png' },
      { id: 'PreAN', name: 'SpaceX PreStocks', symbol: 'SPACEX', decimals: 9, tokenProgram: 'Tokenz', liquidity: 113_188 },
    );
    expect(t).toMatchObject({ mint: 'PreAN', ticker: 'pSPACEX', name: 'SpaceX', source: 'PreStocks', assetType: 'pre_ipo', decimals: 9, markPrice: 151.83, uiPrice: 121.63, liquidityUsd: 113_188 });
  });

  it('maps a Tessera entry (issuer code as ticker, no on-chain price of its own)', () => {
    const t = fromTessera({ id: 'T-OpenAI', name: 'T-OpenAI', symbol: 'T-OpenAI', code: 'tOpenAI', sector: 'AI', mint: 'oPAi', markPrice: 812.79 }, undefined);
    expect(t).toMatchObject({ ticker: 'tOpenAI', name: 'OpenAI', source: 'Tessera', assetType: 'pre_ipo', markPrice: 812.79, uiPrice: null, liquidityUsd: null });
  });

  it('classifies xStocks ETFs and strips the issuer suffix', () => {
    expect(fromXStock({ id: 'Xso', name: 'SP500 xStock', symbol: 'SPYx', decimals: 8, tokenProgram: 'Tokenz' })).toMatchObject({ assetType: 'etf', name: 'SP500' });
    expect(fromXStock({ id: 'Xsc', name: 'NVIDIA xStock', symbol: 'NVDAx', decimals: 8, tokenProgram: 'Tokenz' })).toMatchObject({ assetType: 'public_stock', name: 'NVIDIA' });
  });
});

describe('Jupiter price → per-raw-token price', () => {
  it('uses the pre-scaled price when a Token-2022 scaled-UI multiplier is in force', () => {
    const p = rawPrice(
      { usdPrice: 121.63, decimals: 9, scaledUiConfig: { multiplier: 1, newMultiplier: 5, newMultiplierEffectiveAt: '2026-06-10T04:30:00Z', usdPricePrescaled: 608.16 } },
      Date.parse('2026-09-21T00:00:00Z'),
    );
    expect(p).toEqual({ uiPrice: 121.63, rawPrice: 608.16, multiplier: 608.16 / 121.63 });
  });

  it('applies the pending multiplier only after it takes effect', () => {
    const cfg = { multiplier: 1.0039, newMultiplier: 1.0057, newMultiplierEffectiveAt: '2026-12-01T00:00:00Z' };
    expect(rawPrice({ usdPrice: 100, decimals: 8, scaledUiConfig: cfg }, Date.parse('2026-09-21T00:00:00Z')).rawPrice).toBeCloseTo(100.39, 6);
    expect(rawPrice({ usdPrice: 100, decimals: 8 }).rawPrice).toBe(100);
  });
});
