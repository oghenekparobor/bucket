import { config } from '../../config.js';
import { fetchJson, type FetchResult } from '../../util/http.js';

/**
 * One entry of https://rest-api.tessera.pe/v1/public/token-details (no API key; checked 21 Sep 2026).
 * There is no on-chain price here; it comes from Jupiter price v3.
 */
export interface TesseraToken {
  id: string; // "T-OpenAI"
  name: string;
  symbol: string;
  code: string; // "tOpenAI"
  sector?: string;
  mint: string;
  markPrice: number; // per UI token
  holders?: number;
  markValuation?: number;
}

export function fetchTessera(): Promise<FetchResult<TesseraToken[]>> {
  return fetchJson<TesseraToken[]>(config.TESSERA_URL);
}
