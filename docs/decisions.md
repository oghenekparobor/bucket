# Decisions log

Phase 0.1 asks for decisions to be written down before the build. This log separates **engineering decisions made while building** (owned by Program/Backend, taken here) from **product and legal decisions that are still open** (the build uses the spec's assumptions as configurable defaults, so nothing is blocked, but someone with authority has to confirm them).

Every product number below is a field in the on-chain `Config` (`update_config`, admin only) or a backend env var, so changing one does not require a program change.

## Open: needs a Product or Legal owner

| Checklist item | What the build assumes today | Where it lives |
| --- | --- | --- |
| Commission split: does the platform keep 20% of the creator's 20%? | Yes: `platform_share_bps = 2000` (spec assumption; the design shows "Platform share of that: 20%") | `Config.params` |
| 0.20% fee on mints and redeems | Mint fee 0.20% (`mint_fee_bps = 20`). **Redeem fee 0** (`redeem_fee_bps = 0`), because the spec's P0 acceptance criteria say "no exit fee" and the design shows "Exit fee: none", while the platform-revenue section proposes 0.20% on redeems. These contradict each other. Pick one. | `Config.params` |
| ~~Who seeds each bucket's Meteora pool, and how much~~ | **Closed 23 Sep 2026: no pools at launch**, so nobody seeds one. Rationale and the conditions for revisiting are in "Taken: product" below | – |
| Smallest amount that mints through the vault (below it, route to the pool) | Moot at launch (no pools). Reopens per bucket if one is ever seeded. Program minimum is $1, and every leg ≥ 1 cent fills (tested down to a 2-cent leg). The venue's minimum tradeable size per token is in `spikes/catalog-and-routing.md` | backend quote routing |
| Weight caps 50% public / 25% pre-IPO | As spec | `Config.params` |
| Linked X required for the leaderboard? | Not required; verified badge shown when linked | backend leaderboard job |
| Fee sponsorship policy | Sponsor every transaction (Bucket fee payer), no cap yet | backend `FEE_SPONSOR_*` |
| Launch jurisdictions, licence, commission legality, issuer terms | Open; counsel not engaged. See `legal/` drafts, which are **not reviewed** | – |

## Taken: product

**P1. No Meteora pools at launch (23 Sep 2026).** Buckets ship with mint and redeem through the vault only. The pool route stays unbuilt, and the tickets that depend on it (BKT-022, 025, 030, 031, 044) are deferred by decision rather than unfinished.

Why:

- **A pool bypasses the geo-restrictions the issuers require.** `legal/geo-restrictions.md` builds a strictest-of block list from Backed, PreStocks and Tessera, and defines blocked as "no mint, no pool swap through the app, no bucket creation". A public pool is reachable from Jupiter and every other aggregator, not just the app, and the bucket token has no freeze authority, so a pool would be a permanent, unblockable buy door for exactly the jurisdictions the issuer terms exclude — before counsel has reviewed the draft.
- **The liquidity does not exist at this size.** `spikes/meteora-pool.md` measured that a bucket needs **$10k–$20k per side** before a $100 buy costs under 1%. The creator minimum stake is $25. Below that depth, minting is cheaper for anything above a few dollars, so the pool would mostly serve worse prices.
- **A thin pool would become the public price.** Aggregators and wallets would quote pool price, not unit price. On a ~$2k pool a single $100 buy moves it ~10%. The app's cheaper-of-two-routes logic (`api/quote.ts`) protects Bucket's own users, not everyone reading a price feed.
- **Holding the peg needs an active market maker.** Mint and redeem fill leg by leg through the keeper, so arbitrage carries time and price risk. The spike already assigns that job to the platform at launch; it is an operational commitment, not a side effect.
- **Exits do not need a pool.** Engineering decision 4 below: redeem never depends on the keeper, API, creator or pool. Exit liquidity is already guaranteed by the program.

What a pool would add is discoverability and composability. Both are real, and both are premature while the price it advertises would be wrong.

**Revisit per bucket, not platform-wide**, once all of: TVL makes $10k–$20k a side proportionate; there is real demand for trades too small to mint; a funded market-making wallet runs liquidity concentrated around unit price and moves it as unit price moves (the spike measured several-fold less impact for the same seed); counsel has ruled on the geo bypass; and BKT-058 has shipped.

Note that this decision does not stop a third party from opening a pool for a bucket token — nothing can, since the token is transferable with no freeze authority. BKT-059 covers noticing when that happens.

## Taken: engineering (Program + Backend)

1. **Devnet approach: mock mints with mirrored prices.** One mock Token-2022 mint per real mainnet token (31 today), with the same decimals and the same issuer transfer fee. A `mock_swap` program is the venue and holds mint authority, so liquidity is unlimited. The backend price pusher mirrors live mainnet prices into both the vault's `Asset` feed and the mock markets. See `vault/scripts/catalog.json`, `vault/deployments/*.json`.

2. **How the program prices things (`settle_commission`, mint).** Each allowed mint has an `Asset` account that is also its price feed, pushed by a dedicated **price authority** key (not the keeper, not the admin):
   - every push is **clamped to ±20% of the on-chain TWAP** (`max_price_move_bps`), so a bad or manipulated print cannot move valuation far in one step;
   - the TWAP moves toward each push in proportion to elapsed time over a 30-minute window;
   - **commission values the vault at min(spot, TWAP) per holding**, so a short spike cannot mint fee tokens; the creator is paid once the higher price has persisted;
   - prices older than 1 hour block mints and keeper sells, but **never block redeem** (redeem skips settlement and emits `settled: false`);
   - the admin can `force_price` for corporate actions (splits via scaled-UI multipliers).
   Public stocks: the backend pushes an oracle or DEX price. Pre-IPO tokens have no oracle, so the backend pushes a time-weighted DEX price, and the on-chain clamp and TWAP bound it again.
   **Trade-off, measured in `vault/scripts/e2e.ts`:** right after a sharp rise, commission is only partly collected until the TWAP catches up, so a holder who exits immediately pays less than 20% of that rise. We accept this as the cost of manipulation resistance (spec risk: "Commission valuation is manipulated").

3. **Mint uses prices; redeem does not.** The spec's notes say mint and redeem are proportional "so they need no price oracle". Redeem is purely proportional. Mint is proportional too: legs are budgeted by current vault value weights and quantities land in proportion. But filling legs across several transactions and bounding slippage both need a reference price, so each leg issues `min(qty × reference price, USDC spent) / unit price` tokens. The `min` means a stale-high reference can never dilute existing holders; the backer bears their own swap costs. Settlement runs first in the same instruction, so the reference prices are the ones commission just used. The invariant test runs 60 random operations and asserts supply × unit price = vault value, and that no mint or redeem lowers unit price.

4. **Redeem never depends on the keeper, API, creator or pool.** `redeem` burns and reserves the holder's slice. The holder can then sell it themselves (`fill_redeem` as holder, with their own min-out) or take the tokens in kind (`claim_redeem_in_kind`). `vault/scripts/cli.ts` does all of this with just an exported key and an RPC URL.

5. **Swaps are CPIs into an allow-listed program, checked by balances.** Mint legs are signed by the order PDA, which owns nothing but that order's USDC escrow. Redeem and rebalance legs are signed by the bucket PDA, behind a guard that rejects the bucket mint and every other bucket-owned token account from the CPI's account list. After each swap the program checks balance deltas, slippage against the reference price, and that the source account's owner, delegate and close authority are unchanged. Allow-list: `mock_swap` on devnet, Jupiter v6 on mainnet.

6. **Issuer transfer fees** are allowed on top of the 1% slippage bound per asset (`Asset.extra_cost_bps`); without that allowance no PreStocks leg could fill (see `spikes/token-programs.md`).

7. **Commission is paid into program-owned fee accounts** (one creator, one platform per bucket), claimable by the creator or to the platform fee wallet. If commission were minted straight to the creator's wallet, a creator could close their token account and block settlement, and with it every mint and redeem.

8. **Sub-cent redeem slices** are not reserved: they stay with the remaining holders. Otherwise a tiny redeem would leave an unsellable leg reserved forever.

9. **Edits:** new vault token accounts are created in the creator's `propose_edit` transaction, with the creator as payer (checklist: "charge the creator the rent"). Holdings an edit removes stay as zero-weight entries until the keeper has sold them down; `rebalance` or `settle_commission` prunes them once empty. Rebalances must go from an over-weight to an under-weight holding, sized within the excess, against the vault value from the last settlement (at most 1 hour old).

10. **Program size.** `bucket_vault.so` is ~979 KB (≈6.8 SOL rent), up from ~890 KB when Metaplex metadata support was linked in. An `opt-level = "s"` build saved only 13% and cost ~50% more compute, so we kept the default. A program account is sized at its first deploy, so an upgrade past that size needs `solana program extend` first — see `ops/deploy.md`.

11. **Bucket tokens carry Metaplex metadata (23 Sep 2026).** Without it every bucket token is an
   unknown token in wallets, explorers and DEX listings — no name, no ticker, no image. The mint
   authority is the bucket PDA and Metaplex requires the mint authority to sign, so this can only be
   done by the program: `create_token_metadata` / `update_token_metadata`, with the bucket PDA kept
   as update authority so nobody can rewrite a bucket's identity outside the program.
   - **The ticker is derived from the name** (letters and digits, uppercased, 10 max: "Tokenized
     SP500" → TOKENIZEDS), rather than adding a `symbol` field to the `Bucket` account. It avoids an
     on-chain state change and a new create-form field; the cost is that two similarly named buckets
     can share a ticker. Revisit if creators ask for their own. The rule lives in `metadata.rs` and
     is mirrored in the SDK as `deriveSymbol`, with one shared set of test cases.
   - **The `uri` is served by the API** (`/v1/buckets/<address>/token.json`), not uploaded to
     Arweave, so a rename shows up without a chain write. The on-chain name and ticker still stand on
     their own if the API is unreachable.
   - **The keeper may also sign it.** The metadata transaction is last in the publish batch and can
     expire; the `token-metadata` job then backfills it without the creator coming back. The keeper
     could already act for every bucket, and metadata moves no funds.
