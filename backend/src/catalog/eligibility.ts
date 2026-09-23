/**
 * Catalog eligibility: a token can go into a new bucket only if it is not flagged, has a live on-chain
 * price, and its liquidity (Jupiter `liquidity`, USD) is at or above the floor (default $250k). With
 * REQUIRE_QUOTE_PROBE, the Jupiter quote probe must also have found a route under the price-impact bound
 * at or below MAX_MIN_TRADE_USD.
 */
export interface CatalogEligibilityInput {
  flagged: boolean;
  hasPrice: boolean;
  liquidityUsd: number | null;
  minTradeUsd: number | null;
}

export interface EligibilityRules {
  floorUsd: number;
  requireQuoteProbe: boolean;
  maxMinTradeUsd: number;
}

export function catalogEligibility(t: CatalogEligibilityInput, rules: EligibilityRules): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (t.flagged) reasons.push('flagged');
  if (!t.hasPrice) reasons.push('no_price');
  if (t.liquidityUsd === null || t.liquidityUsd < rules.floorUsd) reasons.push('below_liquidity_floor');
  if (rules.requireQuoteProbe && (t.minTradeUsd === null || t.minTradeUsd > rules.maxMinTradeUsd)) reasons.push('no_route');
  return { eligible: reasons.length === 0, reasons };
}

/** Weight cap per asset type, in whole percent (product-v2: 50% public, 25% pre-IPO). */
export function maxWeightPct(assetType: string): number {
  return assetType === 'pre_ipo' ? 25 : 50;
}
