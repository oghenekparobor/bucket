export type Source = 'xStocks' | 'PreStocks' | 'Tessera';
export type AssetType = 'public_stock' | 'etf' | 'pre_ipo';

/** A token as reported by its issuer feed, enriched with Jupiter metadata. Prices per UI token. */
export interface SourceToken {
  mint: string;
  ticker: string;
  name: string;
  source: Source;
  assetType: AssetType;
  decimals: number;
  tokenProgram: string | null;
  logo: string | null;
  sector: string | null;
  uiPrice: number | null; // issuer- or Jupiter-reported market price, fallback only (price service is canonical)
  markPrice: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  payload: unknown;
}

export interface SourceFetch {
  source: Source;
  ok: boolean;
  tokens: SourceToken[];
  error?: string;
}
