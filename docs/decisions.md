# Decisions log

Phase 0.1 asks for decisions to be written down before the build. This log separates **engineering decisions made while building** (owned by Program/Backend, taken here) from **product and legal decisions that are still open** (the build uses the spec's assumptions as configurable defaults, so nothing is blocked, but someone with authority has to confirm them).

Every product number below is a field in the on-chain `Config` (`update_config`, admin only) or a backend env var, so changing one does not require a program change.

## Open: needs a Product or Legal owner

| Checklist item | What the build assumes today | Where it lives |
| --- | --- | --- |
| Commission split: does the platform keep 20% of the creator's 20%? | Yes: `platform_share_bps = 2000` (spec assumption; the design shows "Platform share of that: 20%") | `Config.params` |
| 0.20% fee on mints and redeems | Mint fee 0.20% (`mint_fee_bps = 20`). **Redeem fee 0** (`redeem_fee_bps = 0`), because the spec's P0 acceptance criteria say "no exit fee" and the design shows "Exit fee: none", while the platform-revenue section proposes 0.20% on redeems. These contradict each other. Pick one. | `Config.params` |
| Who seeds each bucket's Meteora pool, and how much | Not decided; pools not built (phase 2.2) | – |
| Smallest amount that mints through the vault (below it, route to the pool) | Not decided. Program minimum is $1, and every leg ≥ 1 cent fills (tested down to a 2-cent leg). The venue's minimum tradeable size per token is in `spikes/catalog-and-routing.md` | backend quote routing |
| Weight caps 50% public / 25% pre-IPO | As spec | `Config.params` |
| Linked X required for the leaderboard? | Not required; verified badge shown when linked | backend leaderboard job |
| Fee sponsorship policy | Sponsor every transaction (Bucket fee payer), no cap yet | backend `FEE_SPONSOR_*` |
| Launch jurisdictions, licence, commission legality, issuer terms | Open; counsel not engaged. See `legal/` drafts, which are **not reviewed** | – |

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

10. **Program size.** `bucket_vault.so` is ~890 KB (≈6.3 SOL rent). An `opt-level = "s"` build saved only 13% and cost ~50% more compute, so we kept the default.
