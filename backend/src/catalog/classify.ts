import type { JupToken } from './sources/jupiter.js';
import type { PreStocksToken } from './sources/prestocks.js';
import type { TesseraToken } from './sources/tessera.js';
import type { SourceToken } from './types.js';
import { XSTOCKS_ETFS } from './xstocks.js';

/**
 * Field mapping from each issuer feed to the catalog (documented in docs/spikes/catalog-and-routing.md).
 * Tickers: xStocks keep their symbol (NVDAx); PreStocks get a "p" prefix (SPACEX → pSPACEX) and Tessera
 * use their own `code` (tOpenAI), so the same company from three issuers never collides.
 */
export function fromXStock(t: JupToken): SourceToken {
  const base = t.symbol.replace(/x$/, '');
  return {
    mint: t.id,
    ticker: t.symbol,
    name: t.name.replace(/\s*xStock$/i, '').trim() || t.symbol,
    source: 'xStocks',
    assetType: XSTOCKS_ETFS.has(base) ? 'etf' : 'public_stock',
    decimals: t.decimals,
    tokenProgram: t.tokenProgram ?? null,
    logo: t.icon ?? null,
    sector: null,
    uiPrice: t.usdPrice ?? null,
    markPrice: null,
    liquidityUsd: t.liquidity ?? null,
    holders: t.holderCount ?? null,
    payload: { symbol: t.symbol, name: t.name, tags: t.tags, isVerified: t.isVerified },
  };
}

export function fromPreStock(p: PreStocksToken, jup: JupToken | undefined): SourceToken {
  return {
    mint: p.contract_address,
    ticker: `p${p.symbol.toUpperCase()}`,
    name: p.name.replace(/\s*PreStocks?$/i, '').trim() || p.symbol,
    source: 'PreStocks',
    assetType: 'pre_ipo',
    decimals: jup?.decimals ?? 9,
    tokenProgram: jup?.tokenProgram ?? null,
    logo: p.image ?? jup?.icon ?? null,
    sector: null,
    uiPrice: p.tokenPrice ?? jup?.usdPrice ?? null,
    markPrice: p.markPrice ?? null,
    liquidityUsd: jup?.liquidity ?? null,
    holders: jup?.holderCount ?? null,
    payload: {
      symbol: p.symbol,
      markValuation: p.markValuation,
      impliedValuation: p.impliedValuation,
      supply: p.supply,
      external_url: p.external_url,
    },
  };
}

export function fromTessera(t: TesseraToken, jup: JupToken | undefined): SourceToken {
  return {
    mint: t.mint,
    ticker: t.code,
    name: t.name.replace(/^T-/, '').trim() || t.code,
    source: 'Tessera',
    assetType: 'pre_ipo',
    decimals: jup?.decimals ?? 9,
    tokenProgram: jup?.tokenProgram ?? null,
    logo: jup?.icon ?? null,
    sector: t.sector ?? null,
    uiPrice: jup?.usdPrice ?? null,
    markPrice: t.markPrice ?? null,
    liquidityUsd: jup?.liquidity ?? null,
    holders: t.holders ?? jup?.holderCount ?? null,
    payload: { id: t.id, symbol: t.symbol, markValuation: t.markValuation },
  };
}
