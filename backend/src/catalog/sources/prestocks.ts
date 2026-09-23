import { config } from '../../config.js';
import { fetchJson, type FetchResult } from '../../util/http.js';

/** One entry of https://prestocks.com/api/prestocks (checked 21 Sep 2026). Prices are per UI token. */
export interface PreStocksToken {
  name: string; // "SpaceX PreStocks"
  symbol: string; // "SPACEX"
  description?: string;
  image?: string;
  external_url?: string;
  contract_address: string; // the Solana mint
  markPrice: number; // issuer mark (SPV valuation per token)
  markValuation?: number;
  tokenPrice: number; // on-chain market price
  impliedValuation?: number;
  supply?: number;
}

export function fetchPreStocks(): Promise<FetchResult<PreStocksToken[]>> {
  return fetchJson<PreStocksToken[]>(config.PRESTOCKS_URL);
}
