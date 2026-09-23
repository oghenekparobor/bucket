/**
 * Jupiter quote probe: the smallest USDC amount that routes into a token with price impact under the
 * bound, and the largest size (from a ladder) that still does. Also records the effective cost of each
 * quote against the Jupiter reference price (fees + spread + impact), which is what the program's
 * slippage check compares against.
 */
import { USDC_MAINNET, fetchQuote } from './sources/jupiter.js';

export interface ProbeSample {
  usd: number;
  ok: boolean;
  priceImpactPct: number | null;
  /** Value received vs USDC paid, at the reference price, minus 1 (negative = cost). */
  deviationPct: number | null;
  route: string | null;
  error: string | null;
}

export interface ProbeResult {
  minTradeUsd: number | null;
  depthUsd: number | null;
  samples: ProbeSample[];
}

export const MIN_LADDER = [0.01, 0.1, 1, 10, 100];
export const DEPTH_LADDER = [1_000, 10_000, 50_000, 250_000];

export async function quoteSample(mint: string, decimals: number, rawPriceUsd: number, usd: number): Promise<ProbeSample> {
  const r = await fetchQuote(USDC_MAINNET, mint, BigInt(Math.round(usd * 1e6)));
  const q = r.data;
  if (!r.ok || !q || BigInt(q.outAmount) <= 0n) {
    return { usd, ok: false, priceImpactPct: null, deviationPct: null, route: null, error: r.error ?? 'no route' };
  }
  const valueOut = (Number(q.outAmount) / 10 ** decimals) * rawPriceUsd;
  return {
    usd,
    ok: true,
    priceImpactPct: Math.abs(Number(q.priceImpactPct)) * 100,
    deviationPct: rawPriceUsd > 0 ? (valueOut / usd - 1) * 100 : null,
    route: [...new Set(q.routePlan.map((s) => s.swapInfo.label))].join(' + '),
    error: null,
  };
}

export async function probeMint(
  mint: string,
  decimals: number,
  rawPriceUsd: number,
  opts: { maxImpactPct: number; depth: boolean },
): Promise<ProbeResult> {
  const passes = (s: ProbeSample) => s.ok && (s.priceImpactPct ?? Infinity) < opts.maxImpactPct;
  const samples: ProbeSample[] = [];
  let minTradeUsd: number | null = null;
  for (const usd of MIN_LADDER) {
    const s = await quoteSample(mint, decimals, rawPriceUsd, usd);
    samples.push(s);
    if (passes(s)) {
      minTradeUsd = usd;
      break;
    }
  }
  let depthUsd: number | null = null;
  if (minTradeUsd !== null && opts.depth) {
    for (const usd of DEPTH_LADDER) {
      const s = await quoteSample(mint, decimals, rawPriceUsd, usd);
      samples.push(s);
      if (!passes(s)) break;
      depthUsd = usd;
    }
  }
  return { minTradeUsd, depthUsd, samples };
}
