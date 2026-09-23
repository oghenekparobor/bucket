# Spike: a Meteora DAMM v2 pool per bucket

Checklist 0.3: *Prototype creating a Meteora DAMM v2 pool for a program-minted token against USDC, using the Meteora SDK.*

Reproduce: `cd vault/scripts && pnpm exec tsx spike-meteora.ts [--seed-usd 1000]`. The script runs on devnet with a scratch wallet and writes `meteora-pool.json` next to this file.

## Result: works

- **SDK:** `@meteora-ag/cp-amm-sdk` 1.4.9, `CpAmm.createCustomPool`. A customizable pool needs **no Meteora-owned config account**, so Bucket sets fee and range per pool.
- The pool address is deterministic from the two mints (`deriveCustomizablePoolAddress(bucketMint, usdc)`), so the program, backend and web can all find a bucket's pool without storing it. Verified: the created pool matched the derived address.
- The bucket token was a classic SPL mint whose **mint authority had already moved to a PDA**, exactly as `bucket_vault` mints do. The pool only needs the seed tokens, not mint authority.
- Created on devnet in **one transaction** (pool + first position NFT), then quoted and executed a $10 USDC → token swap. Total cost including all rent: **0.022 SOL**.
- Fee setup used: 30 bps base fee, fees collected in USDC only (`CollectFeeMode.OnlyB`), full price range, liquidity not locked.

## Price impact, and what it means for the seeding decision

Seed of $1,000 USDC + 10 tokens at $100 (full-range constant product, ~$2,000 TVL):

| Buy | Tokens out | Effective price | vs unit price |
| --- | --- | --- | --- |
| $1 | 0.00996 | $100.40 | +0.40% (mostly the 30 bps fee) |
| $10 | 0.0987 | $101.30 | +1.30% |
| $100 | 0.9066 | $110.30 | +10.3% |
| $250 | 1.9952 | $125.30 | +25.3% |

A full-range pool's impact is roughly `trade / pool USDC side`. For a $100 buy to cost under 1% more than minting, the pool needs about **$10k–$20k per side**. At the $25 creator minimum, a creator-seeded pool is only useful for trades of a few dollars. The mint route (cost = swap fees + issuer fees, measured ~0.35–1.3% depending on pre-IPO weight) beats the pool above that size.

Inputs for the Phase 0 decision "who seeds the pool and with how much":
1. A tiny seed is fine as long as the app always quotes both routes and takes the cheaper one (checklist 2.2). Small buys then go to the pool, and everything above a few dollars goes to mint.
2. The spec's "amounts below the vault minimum route to the pool" only works if the pool is deep enough at that size. Using the numbers above, set the vault minimum at no more than ~0.5% of the pool's USDC side.
3. Arbitrage keeps pool price near unit price only if someone can mint/redeem at size and trade the pool. That is the platform's job at launch; a platform market-making wallet funded per bucket would do it.
4. Concentrating liquidity around unit price (a narrow `sqrtMinPrice`/`sqrtMaxPrice` band) would cut impact several-fold for the same seed. Worth testing in 2.2, but the band must move as unit price moves.

## Integration notes for 2.2

- At publish, after the creator's first mint, the backend builds `createCustomPool` with the pool seed. Pool creation does not need the bucket program to sign, because the seeding wallet (creator or platform) holds the tokens.
- DAMM v2 supports Token-2022, but the bucket token is classic SPL, so none of the xStocks extension issues apply to the pool itself.
- Quoting: `CpAmm.getQuote` with the live pool state. Compare it with `math.quoteMint`/`quoteRedeem` from `@bucket/sdk` and route to the cheaper.
