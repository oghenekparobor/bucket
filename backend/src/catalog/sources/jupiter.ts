/**
 * Jupiter lite API: token search (metadata, liquidity), price v3 (on-chain price incl. Token-2022
 * scaled-UI config) and swap quotes (routing probe).
 */
import { config } from '../../config.js';
import { fetchJson, type FetchResult } from '../../util/http.js';
import { sleep } from '../../util/time.js';

export const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface JupToken {
  id: string;
  name: string;
  symbol: string;
  icon?: string | null;
  decimals: number;
  tokenProgram: string;
  usdPrice?: number | null;
  liquidity?: number | null;
  holderCount?: number | null;
  tags?: string[] | null;
  isVerified?: boolean | null;
}

export interface JupScaledUiConfig {
  multiplier: number;
  newMultiplier?: number;
  newMultiplierEffectiveAt?: string;
  usdPricePrescaled?: number;
}

export interface JupPrice {
  usdPrice: number;
  decimals: number;
  liquidity?: number;
  blockId?: number;
  priceChange24h?: number;
  stockData?: { id: string; price: number; mcap?: number; updatedAt?: string };
  scaledUiConfig?: JupScaledUiConfig;
}

export interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label: string; ammKey: string } }[];
}

/**
 * The keyless lite API rate-limits per IP (HTTP 429 when exceeded), so every Jupiter call in this process
 * goes through one gate that spaces requests JUPITER_MIN_INTERVAL_MS apart, and retries back off on 429.
 */
let nextSlot = 0;
async function gated<T>(url: string, retries = 4): Promise<FetchResult<T>> {
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Math.max(nextSlot, Date.now()) + config.JUPITER_MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
  return fetchJson<T>(url, { retries });
}

export function searchTokens(query: string): Promise<FetchResult<JupToken[]>> {
  return gated<JupToken[]>(`${config.JUPITER_API_BASE}/tokens/v2/search?query=${encodeURIComponent(query)}`);
}

/** Looks tokens up by mint, up to 100 mints per request (comma-separated query). */
export function lookupMints(mints: string[]): Promise<FetchResult<JupToken[]>> {
  return searchTokens(mints.join(','));
}

export function fetchPrices(mints: string[]): Promise<FetchResult<Record<string, JupPrice | null>>> {
  return gated<Record<string, JupPrice | null>>(`${config.JUPITER_API_BASE}/price/v3?ids=${mints.join(',')}`);
}

export function fetchQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 100): Promise<FetchResult<JupQuote>> {
  const qs = new URLSearchParams({ inputMint, outputMint, amount: amount.toString(), slippageBps: String(slippageBps) });
  return gated<JupQuote>(`${config.JUPITER_API_BASE}/swap/v1/quote?${qs}`);
}

/**
 * Price of one whole raw token (before the Token-2022 scaled-UI multiplier) and the multiplier in
 * force. Jupiter reports `usdPrice` per UI token; `usdPricePrescaled` is the per-raw-token price.
 */
export function rawPrice(p: JupPrice, nowMs = Date.now()): { uiPrice: number; rawPrice: number; multiplier: number } {
  const cfg = p.scaledUiConfig;
  if (!cfg) return { uiPrice: p.usdPrice, rawPrice: p.usdPrice, multiplier: 1 };
  const effectiveAt = cfg.newMultiplierEffectiveAt ? Date.parse(cfg.newMultiplierEffectiveAt) : Number.POSITIVE_INFINITY;
  const multiplier = cfg.newMultiplier !== undefined && nowMs >= effectiveAt ? cfg.newMultiplier : cfg.multiplier;
  const raw = cfg.usdPricePrescaled ?? p.usdPrice * multiplier;
  return { uiPrice: p.usdPrice, rawPrice: raw, multiplier: p.usdPrice > 0 ? raw / p.usdPrice : multiplier };
}
