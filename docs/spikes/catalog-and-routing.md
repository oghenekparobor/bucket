# Spike: catalog sources and swap routing

Checklist 0.3 (Backend): prototype routing for every catalog token and record the minimum tradeable size;
map `prestocks.com/api/prestocks` to the catalog; get Tessera's `token-details` working. Checklist 0.1:
set the liquidity floor and count the tokens that pass it.

All numbers are from live calls on **21 Sep 2026** (catalog sync and quote probe run 21:38–21:54 UTC,
`pnpm --filter @bucket/backend spike:routing`). The probe results are also stored on each asset
(`assets.probe`, `min_trade_usd`, `depth_1pct_usd`) and refreshed daily by the `routing-probe` job.

## Summary

| Source | Tokens listed | Priced by Jupiter | Above $250k liquidity | Route under 1% impact at some size | Eligible today |
| --- | ---: | ---: | ---: | ---: | ---: |
| xStocks | 154 | 85 | 19 | 48 | 19 |
| PreStocks | 8 | 8 | 4 | 3 | 4 (1 if the quote probe is required) |
| Tessera | 3 | 3 | 1 | 3 | 1 |
| **Total** | **165** | **96** | **24** | **54** | **24** (21 with the quote probe) |

- **Floor.** Default `LIQUIDITY_FLOOR_USD=250000` on Jupiter's `liquidity` field. 24 tokens pass. SpaceX
  PreStocks and T-SpaceX are also excluded by issuer events (see below); both are under the floor anyway.
- **Liquidity is not tradability for PreStocks.** Three PreStocks above the floor (pOPENAI $779k,
  pANDURIL $387k, pNEURALINK $266k) never quote under 1% price impact: every size from $0.01 to $100 sits
  2.9–3.5% below Jupiter's reference price. That is a standing spread against Jupiter's reference price, not size
  impact. With `REQUIRE_QUOTE_PROBE=true` they become ineligible (21 tokens). Recommend
  turning the probe requirement on for mainnet; the program's 1% slippage bound (+ `extra_cost_bps`) would
  reject most fills in those names anyway.
- **Minimum tradeable size.** For every token that routes under 1% impact, the smallest size is $0.01
  except HOODx ($1: impact 1.008% at $0.01, 0.999% at $1), AMZNx ($1) and MRVLx ($10). A minimum is not
  what limits mints; the spread is. Depth under 1% impact is ≥ $250k only for SPYx, CRCLx, TSLAx and GLDx.
- **Rate limits.** The keyless `lite-api.jup.ag` returned HTTP 429 on 62 of 155 search calls and on the
  price call when the sync ran at concurrency 3. All Jupiter calls now go through one gate spaced
  `JUPITER_MIN_INTERVAL_MS` (300 ms) apart with 2 s × 2ⁿ backoff on 429; no 429 since. Steady-state syncs
  only query tickers not already known, so they make ~5 calls, not ~155.

## xStocks discovery (Jupiter token search)

- `https://lite-api.jup.ag/tokens/v2/search?query=<q>` returns at most 20 tokens. `query=xStock` returns the
  20 most liquid; `xStocks` and `xstocks` return nothing. `tokens/v2/tag?query=xstocks` is rejected
  ("Invalid tag provided"); only `verified`/`lst` tags work.
- Per-ticker queries (`NVDAx`, `SPYx`, …) resolve almost every listing; a few only appear through other
  queries (`Vx`, `VTIx`, `WMTx` returned no xStocks result themselves). The maintained list in
  `src/catalog/xstocks.ts` has 154 tickers; every token must carry Jupiter's `xstocks` tag.
- A comma-separated list of up to 100 mints also works as a query. Every known xStocks mint is re-checked
  by address each sync, so a token that drops out of search ranking is not mistaken for a delisting.
- Per Backed's terms we do not scrape xstocks.fi; Jupiter's token API is the only xStocks source.
- Decimals 8, Token-2022 for all 154.

## PreStocks feed → catalog

`GET https://prestocks.com/api/prestocks`: HTTP 200, 0.5–3.5 s, no key, 8 tokens, no rate-limit headers.

| PreStocks field | Example (SpaceX) | Catalog column | Notes |
| --- | --- | --- | --- |
| `contract_address` | `PreANxuX…sfTh` | `mint` | Solana mint (Token-2022, 9 decimals via Jupiter) |
| `symbol` | `SPACEX` | `ticker` = `pSPACEX` | `p` prefix so it never collides with SPCXx or tSpaceX |
| `name` | `SpaceX PreStocks` | `name` = `SpaceX` | issuer suffix stripped |
| `markPrice` | 151.83 | `mark_price_e6`, `asset_prices(kind='mark')` | per **UI** unit (SPV mark) |
| `tokenPrice` | 121.63 | fallback only | per **UI** unit; equals Jupiter `usdPrice`; the price service uses Jupiter |
| `supply` | 43712.53 | `source_payload.supply` | UI units (= 8742.5 raw × 5) |
| `impliedValuation`, `markValuation` | 1.35e11 | `source_payload` | informational |
| `image` | logo URL | `logo` | |
| `description`, `external_url` | | `source_payload.external_url` | |
| (Jupiter) `liquidity`, `holderCount`, `decimals`, `tokenProgram` | | `liquidity_usd`, `holders`, `decimals`, `token_program` | looked up by mint |

Every PreStocks token carries a 1% Token-2022 transfer fee (`extra_cost_bps` on-chain). Whether Jupiter's quoted
`outAmount` nets it out was not verified: pANTHROPIC quotes 0.03% impact, which suggests the fee is not in
`priceImpactPct`, so mint quotes add `extra_cost_bps` on top of the probed cost.

## Tessera `token-details`

`GET https://rest-api.tessera.pe/v1/public/token-details`: no key, no rate-limit headers (Cloudflare, ETag).

- Fields: `id` ("T-OpenAI"), `name`, `symbol`, `code` ("tOpenAI", used as `ticker`), `sector`, `mint`,
  `markPrice` (per UI unit), `holders`, `markValuation`. **No on-chain price**: it comes from Jupiter price
  v3 by mint. Jupiter's own `stockData.price` for Tessera mints is *not* Tessera's mark (T-Kalshi shows the
  PreStocks Kalshi mark), so the catalog uses Tessera's `markPrice`.
- 3 tokens today: tOpenAI, tKalshi, tSpaceX. All 9 decimals, Token-2022, no scaled-UI multiplier.
- Latency: 10 sequential requests 315–630 ms, all HTTP 200; single requests inside syncs 0.7–7.9 s.
- Uptime: in the worker's syncs today **2 of 5 syncs failed with HTTP 500** (`{"statusCode":500,"message":
  "Internal server error"}`) after three attempts each (22:05 and 22:13 UTC); 15 of 17 recorded fetches
  succeeded overall. The product spec's "server error" was not a one-off. A failed fetch never flags tokens
  (see "Disappearing tokens"), and fetch health is recorded per source in `source_health` for tracking.

## Prices: UI vs raw, and scaled-UI multipliers

- Jupiter price v3 `usdPrice` is per **UI** unit. When a Token-2022 scaled-UI multiplier is configured it
  also returns `scaledUiConfig { multiplier, newMultiplier, newMultiplierEffectiveAt, usdPricePrescaled }`;
  `usdPricePrescaled` is per **raw** unit and equals `usdPrice × newMultiplier` once
  `newMultiplierEffectiveAt` has passed (else `× multiplier`). The price service stores
  `price_e6 = price_raw` (what `Asset.price_e6` means, docs/architecture.md §1) and `ui_price_e6`.
- The PreStocks feed `tokenPrice` and both issuers' `markPrice` are per UI unit.
- Jupiter swap quotes (`inAmount`/`outAmount`) are in raw base units; the probe values output at the raw price.
- Multipliers in force today (62 tokens ≠ 1), including: NFLXx ×10, pSPACEX ×5 (since 10 Jun 2026), CRWDx ×4,
  TQQQx ×2.009, pOPENAI ×1.486, CMCSAx ×1.088, STRCx ×1.086, AZNx ×0.511, SPYx ×1.0057, NVDAx ×1.0017.
  Treating UI prices as raw would misvalue these vault holdings by up to 10×.
- The devnet/localnet mock mints have no scaled-UI extension. The pusher writes the mainnet **raw** price
  into each mock's `Asset` and `mock_swap` market (one mock raw unit stands for one mainnet raw unit),
  clamped with `math.clampPrice` to the program's ±`max_price_move_bps` of TWAP so venue and Asset agree.

## Issuer events

`config/issuer-events.json` (from docs/legal): **pSPACEX** must be swapped before 12 Mar 2027 23:59 UTC
(`issuer_conversion_deadline`); **tSpaceX** is in its redemption event cycle with no Redemption Start Date
announced (`issuer_redemption_window`, no deadline yet). Both are ineligible for new buckets
(`eligibilityReason`/`deadline` on catalog tokens), and the daily `deadline-alerts` job alerts for every
bucket holding a token whose deadline is under 60 days away.

## Disappearing tokens

A token missing from a *successful* fetch of its source is flagged (`missing_from_source`, blocked from new
buckets, kept in every existing bucket and in the catalog) and audited in `catalog_audit`. The flag clears
automatically if it reappears; manual flags never auto-clear. A failed fetch, or one returning under half
the known tokens, flags nothing. xStocks presence is confirmed by mint lookup before flagging.

## Minimum tradeable size per token (Jupiter quotes, USDC → token)

Ladder $0.01 → $0.1 → $1 → $10 → $100 for the smallest size with price impact under 1% (Jupiter
`priceImpactPct`, a fraction ×100), then $1k/$10k/$50k/$250k for depth under 1%. 96 priced tokens, 388
quotes. "none" = impact ≥ 1% at every size up to $100.

| Ticker | Source | Liquidity (Jupiter) | Eligible | Impact at $0.01 | Smallest size < 1% impact | Depth < 1% impact | Route at $0.01 |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| SPYx | xStocks | $9,028,755 | yes | 0.03% | $0.01 | ≥ $250,000 | Riptide |
| SPCXx | xStocks | $2,556,912 | yes | 0.52% | $0.01 | ≥ $50,000 | Byreal |
| CRCLx | xStocks | $2,435,177 | yes | 0.00% | $0.01 | ≥ $250,000 | Whirlpool |
| NVDAx | xStocks | $2,372,284 | yes | 0.06% | $0.01 | ≥ $50,000 | Whirlpool |
| QQQx | xStocks | $2,152,501 | yes | 0.03% | $0.01 | ≥ $50,000 | Manifest |
| COINx | xStocks | $1,455,131 | yes | 0.19% | $0.01 | ≥ $10,000 | Whirlpool |
| TSLAx | xStocks | $1,416,848 | yes | 0.02% | $0.01 | ≥ $250,000 | Riptide |
| HOODx | xStocks | $1,291,043 | yes | 1.01% | $1 | < $1,000 | Byreal |
| MSTRx | xStocks | $1,182,575 | yes | 0.02% | $0.01 | ≥ $50,000 | Riptide |
| AAPLx | xStocks | $928,029 | yes | 0.48% | $0.01 | ≥ $50,000 | Raydium CLMM |
| GLDx | xStocks | $853,686 | yes | 0.01% | $0.01 | ≥ $250,000 | Whirlpool |
| GMEx | xStocks | $673,439 | yes | 0.00% | $0.01 | ≥ $10,000 | Raydium CLMM |
| MSFTx | xStocks | $619,908 | yes | 0.04% | $0.01 | ≥ $50,000 | Raydium CLMM |
| GOOGLx | xStocks | $529,920 | yes | 0.37% | $0.01 | ≥ $50,000 | Whirlpool |
| STRCx | xStocks | $498,615 | yes | 0.00% | $0.01 | ≥ $50,000 | Byreal |
| METAx | xStocks | $432,932 | yes | 0.40% | $0.01 | ≥ $10,000 | Raydium CLMM |
| MCDx | xStocks | $391,203 | yes | 0.00% | $0.01 | ≥ $50,000 | Manifest |
| AMZNx | xStocks | $358,166 | yes | no quote | $1 | ≥ $50,000 | — |
| PLTRx | xStocks | $256,600 | yes | 0.00% | $0.01 | ≥ $10,000 | Manifest |
| KOx | xStocks | $150,381 | no: below liquidity floor | 0.01% | $0.01 | ≥ $10,000 | Whirlpool |
| DFDVx | xStocks | $89,465 | no: below liquidity floor | 0.00% | $0.01 | ≥ $1,000 | Whirlpool |
| INTCx | xStocks | $76,172 | no: below liquidity floor | 0.00% | $0.01 | ≥ $1,000 | Flux + Raydium CLMM |
| BRK.Bx | xStocks | $74,888 | no: below liquidity floor | 0.47% | $0.01 | ≥ $10,000 | Whirlpool |
| TQQQx | xStocks | $53,554 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Whirlpool |
| AVGOx | xStocks | $52,177 | no: below liquidity floor | 0.00% | $0.01 | ≥ $1,000 | Whirlpool |
| AMDx | xStocks | $14,293 | no: below liquidity floor | 2.03% | none (≥ 1.99% at $0.01–$100) | — | Whirlpool |
| WMTx | xStocks | $11,144 | no: below liquidity floor | 1.78% | none (≥ 1.78% at $0.01–$100) | — | Whirlpool |
| XOMx | xStocks | $8,554 | no: below liquidity floor | 1.06% | none (≥ 1.06% at $0.01–$100) | — | AlphaQ + Raydium CLMM |
| UNHx | xStocks | $7,026 | no: below liquidity floor | 0.04% | $0.01 | < $1,000 | Whirlpool |
| LLYx | xStocks | $4,534 | no: below liquidity floor | 0.07% | $0.01 | < $1,000 | Raydium CLMM |
| ORCLx | xStocks | $4,439 | no: below liquidity floor | 1.99% | none (≥ 1.98% at $0.01–$100) | — | Raydium CLMM |
| CVXx | xStocks | $2,849 | no: below liquidity floor | 0.10% | $0.01 | < $1,000 | Raydium CLMM |
| MRVLx | xStocks | $2,834 | no: below liquidity floor | no quote | $10 | < $1,000 | — |
| TSMx | xStocks | $2,668 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Whirlpool |
| NFLXx | xStocks | $2,653 | no: below liquidity floor | 0.01% | $0.01 | < $1,000 | Raydium CLMM |
| NVOx | xStocks | $2,057 | no: below liquidity floor | 0.72% | $0.01 | < $1,000 | Raydium CLMM |
| IBMx | xStocks | $1,562 | no: below liquidity floor | 3.31% | none (≥ 3.30% at $0.01–$100) | — | Meteora DLMM |
| AZNx | xStocks | $1,339 | no: below liquidity floor | 0.14% | $0.01 | < $1,000 | Raydium CLMM |
| PGx | xStocks | $1,285 | no: below liquidity floor | 0.43% | $0.01 | < $1,000 | Raydium CLMM |
| AMBRx | xStocks | $1,149 | no: below liquidity floor | 3.10% | none (≥ 3.10% at $0.01–$100) | — | Raydium CLMM |
| JPMx | xStocks | $1,039 | no: below liquidity floor | 2.01% | none (≥ 2.00% at $0.01–$100) | — | Raydium CLMM |
| VTIx | xStocks | $978.86 | no: below liquidity floor | 18.61% | none (≥ 18.57% at $0.01–$100) | — | Meteora DLMM |
| PEPx | xStocks | $943.27 | no: below liquidity floor | 0.01% | $0.01 | ≥ $1,000 | Raydium CLMM |
| LINx | xStocks | $843.02 | no: below liquidity floor | 1.82% | none (≥ 1.79% at $0.01–$100) | — | Raydium CLMM |
| BACx | xStocks | $839.18 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| CMCSAx | xStocks | $651.46 | no: below liquidity floor | 19.01% | none (≥ 19.01% at $0.01–$100) | — | Meteora DLMM |
| ABTx | xStocks | $485.42 | no: below liquidity floor | 0.26% | $0.01 | < $1,000 | Raydium CLMM |
| MAx | xStocks | $440.64 | no: below liquidity floor | 70.60% | none (≥ 70.55% at $0.01–$100) | — | Manifest |
| Vx | xStocks | $391.69 | no: below liquidity floor | 2.00% | none (≥ 1.99% at $0.01–$100) | — | Raydium CLMM |
| CSCOx | xStocks | $307.65 | no: below liquidity floor | 4.16% | none (≥ 4.16% at $0.01–$100) | — | FluxBeam |
| MUx | xStocks | $286.18 | no: below liquidity floor | 6.61% | none (≥ 6.55% at $0.01–$100) | — | Manifest |
| PFEx | xStocks | $221.95 | no: below liquidity floor | no quote | no route | — | — |
| HONx | xStocks | $205.29 | no: below liquidity floor | 40.15% | none (≥ 40.15% at $0.01–$100) | — | FluxBeam |
| IWMx | xStocks | $151.99 | no: below liquidity floor | no quote | no route | — | — |
| GSx | xStocks | $144.17 | no: below liquidity floor | 3.58% | none (≥ 3.58% at $0.01–$100) | — | FluxBeam |
| PMx | xStocks | $140.21 | no: below liquidity floor | 4.57% | none (≥ 4.56% at $0.01–$100) | — | Manifest |
| ACNx | xStocks | $138.42 | no: below liquidity floor | no quote | no route | — | — |
| MRKx | xStocks | $122.75 | no: below liquidity floor | 0.54% | $0.01 | < $1,000 | Raydium CLMM |
| UBERx | xStocks | $79.92 | no: below liquidity floor | 65.40% | none (≥ 65.40% at $0.01–$100) | — | FluxBeam |
| ASMLx | xStocks | $54 | no: below liquidity floor | 6.30% | none (≥ 6.30% at $0.01–$100) | — | FluxBeam |
| TMOx | xStocks | $52.37 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| CRWDx | xStocks | $48.45 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| CRMx | xStocks | $46.28 | no: below liquidity floor | 14.33% | none (≥ 14.33% at $0.01–$100) | — | FluxBeam |
| APPx | xStocks | $34.44 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Manifest |
| JNJx | xStocks | $33.48 | no: below liquidity floor | 65.90% | none (≥ 65.89% at $0.01–$100) | — | Manifest |
| SCHFx | xStocks | $24.23 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Manifest |
| IJRx | xStocks | $19.01 | no: below liquidity floor | 9.11% | none (≥ 9.11% at $0.01–$100) | — | FluxBeam |
| ABBVx | xStocks | $1.89 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| AMATx | xStocks | $1.69 | no: below liquidity floor | 34.93% | none (≥ 34.93% at $0.01–$100) | — | FluxBeam |
| VCXx | xStocks | $0.57 | no: below liquidity floor | 88.54% | none (≥ 88.54% at $0.01–$100) | — | Manifest |
| SLVx | xStocks | $0.48 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Whirlpool + Raydium CP |
| TBLLx | xStocks | $0.32 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| IEMGx | xStocks | $0.21 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| VXUSx | xStocks | $0.1 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | FluxBeam |
| PYPLx | xStocks | $0.05 | no: below liquidity floor | 88.23% | none (≥ 88.23% at $0.01–$100) | — | FluxBeam |
| OPENx | xStocks | $0.03 | no: below liquidity floor | 0.00% | $0.01 | < $1,000 | Manifest |
| CMGx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| NOWx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| CRWVx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| NETx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| ARMx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| TTWOx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| SMCIx | xStocks | — | no: below liquidity floor | 95.98% | none (≥ 95.98% at $0.01–$100) | — | FluxBeam |
| VOOx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| QCOMx | xStocks | — | no: below liquidity floor | no quote | no route | — | — |
| pOPENAI | PreStocks | $778,698 | yes | 3.46% | none (≥ 3.45% at $0.01–$100) | — | Manifest |
| pANTHROPIC | PreStocks | $728,458 | yes | 0.03% | $0.01 | < $1,000 | TesseraV + PancakeSwap + Manifest |
| pANDURIL | PreStocks | $386,983 | yes | 2.95% | none (≥ 2.95% at $0.01–$100) | — | Manifest |
| pNEURALINK | PreStocks | $266,255 | yes | 2.87% | none (≥ 2.87% at $0.01–$100) | — | Meteora DLMM |
| pPOLYMARKET | PreStocks | $152,940 | no: below liquidity floor | 0.17% | $0.01 | < $1,000 | Manifest |
| pFIGUREAI | PreStocks | $125,106 | no: below liquidity floor | 0.89% | $0.01 | < $1,000 | Raydium CLMM |
| pSPACEX | PreStocks | $113,038 | no: issuer conversion deadline | 1.32% | none (≥ 1.31% at $0.01–$100) | — | Meteora DLMM |
| pKALSHI | PreStocks | $111,459 | no: below liquidity floor | 1.76% | none (≥ 1.72% at $0.01–$100) | — | Manifest |
| tOpenAI | Tessera | $384,885 | yes | 0.21% | $0.01 | ≥ $1,000 | Meteora DLMM |
| tKalshi | Tessera | $205,644 | no: below liquidity floor | 0.21% | $0.01 | ≥ $10,000 | Meteora DLMM |
| tSpaceX | Tessera | $118,315 | no: issuer redemption window | 0.43% | $0.01 | ≥ $10,000 | Meteora DLMM |

Unpriced tokens (69 xStocks with no Jupiter price, e.g. DHRx, HDx, SNOWx, NOWx) have no recent trades and
were not probed; they are listed but ineligible.
