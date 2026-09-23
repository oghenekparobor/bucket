# Spike: token programs and restrictions (xStocks, PreStocks, Tessera)

Checklist 0.3: *Confirm the token program and any transfer restrictions, freeze authority or transfer hooks on xStocks, PreStocks and Tessera tokens, and that a PDA can hold and swap them.*

Method: `getAccountInfo` (jsonParsed) on mainnet for one mint per issuer, 21 Sept 2026; issuer feeds and Jupiter's token API for the rest. Samples: NVDAx `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`, SpaceX PreStocks `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh`, T-OpenAI `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ`.

## Findings

| | xStocks | PreStocks | Tessera |
| --- | --- | --- | --- |
| Token program | Token-2022 | Token-2022 | Token-2022 |
| Decimals | 8 | 9 | 9 |
| Freeze authority | yes (issuer) | yes (issuer) | yes (issuer) |
| **Permanent delegate** | **yes** (issuer) | **yes** (issuer) | no |
| **Pausable** | **yes**, not paused | **yes**, not paused | no |
| **Transfer fee** | none | **100 bps** (was 50 bps until epoch 1039) | **20 bps** |
| Transfer hook | extension present, program **null** | extension present, program **null** | none |
| Scaled UI amount | yes: 1.0017 **in effect since 10 Sep 2026** (was 1.0009) | yes: **×5 in effect since 10 Jun 2026** (a split; was 1) | none |
| Default account state | initialized | initialized | none |
| Confidential transfer mint | yes (no auto-approve) | yes | none |

## What it means for Bucket, and what the program does about it

1. **All three are Token-2022.** The vault uses `token_interface` / `transfer_checked` for holdings, stores each holding's token program, and creates vault accounts as ATAs under that program, so the extension-sized account layout is handled by the ATA program. Tested with Token-2022 mocks.
2. **Transfer fees are real costs on every leg.** PreStocks charge 1% per transfer, which alone exceeds the spec's 1% slippage bound. `Asset.extra_cost_bps` adds the issuer fee to the allowed slippage for that token (set from the mint's fee config). The test `issuer transfer fee: a PreStocks leg needs its extra-cost allowance` proves a PreStocks leg fails without it and passes with it. The devnet mocks carry the same fees. **Product impact:** buying or selling a PreStocks-heavy bucket costs ~1% more each way. That should show on the confirmation screen and weigh on the minimum-size and pool-routing decision.
3. **Scaled UI amount (splits and dividends).** Raw balances never change; the display multiplier does. The program values everything in raw units (`price_e6` is per whole *raw* token). The price service must convert UI prices: `price_raw = price_ui × multiplier`, using the multiplier in force at that timestamp. If it gets this wrong, a split looks like a 5× price jump. The on-chain ±20% clamp stops that from reaching valuation in one push, and `force_price` exists for the admin to reset at the effective time. SpaceX PreStocks moved from ×1 to ×5 on 10 Jun 2026, so this is not hypothetical. Note that `getAccountInfo` keeps showing the old value under `multiplier` and the current one under `newMultiplier` once its timestamp has passed; the price service must use whichever is in force now. *(Corrected 21 Sep: an earlier version of this note called both multipliers "scheduled"; both timestamps are in the past.)*
4. **Permanent delegate.** xStocks and PreStocks issuers can move tokens out of any account, the vault included. Bucket cannot prevent this. It is a trust assumption on the issuers, and it belongs in the risk disclosures and in counsel's review of issuer terms (0.2).
5. **Pausable.** If an issuer pauses a token, every transfer fails: mint legs and redeem legs for that holding fail, and so does in-kind claim. Redeem itself still burns and reserves, so the holder's claim is recorded and can be taken when the pause lifts. Runbook item: "token paused".
6. **Transfer hooks** are present but have no program set today. If an issuer sets one, CPI transfers need extra accounts, and fills and claims for that token would fail until the SDK adds the hook's extra-account metas. The keeper should alert on a mint whose hook program becomes non-null.
7. **A PDA can hold and swap them:** vault ATAs owned by the bucket PDA receive, hold and send these tokens in the test suite (Token-2022 mocks with transfer fees, 8 and 9 decimals). Mainnet swaps route through Jupiter with the PDA as the swap authority (shared-accounts routing). This has **not yet been exercised on mainnet**, and that is a Phase 2 launch item.

## Issuer deadlines (from the legal research, `docs/legal/issuer-terms.md`)

- **SpaceX PreStocks**: SpaceX listed on Nasdaq on 12 Jun 2026. Holders must swap the PreStocks token before **12 Mar 2027**, or it expires worthless (prestocks.com/spacex).
- **Tessera T-Tokens**: holders must redeem within a **90-day window** from the redemption start date, or lose the claim. **T-SpaceX has already entered its redemption cycle.**
- Consequence for Bucket: a vault can hold a token that expires. The catalog must mark these tokens as not addable, and existing buckets need a forced removal (`admin_propose_removal`, 24h notice) well before the deadline. Runbook: `docs/ops/runbooks.md` §3.

## Liquidity and prices (same day)

- 20 xStocks returned by Jupiter's token search, liquidity from $9.3M (SPYx) down to $0.17M (KOx). Full catalog numbers are in `catalog-and-routing.md` (backend spike).
- PreStocks feed: 8 tokens. The SpaceX token traded at **$116.65 against a $151.83 mark** (–23%), confirming the spec's point that both prices must be shown and returns measured on the token price.
- Tessera feed returned 200 with 3 tokens (T-OpenAI, T-Kalshi, T-SpaceX), **no on-chain price field** (mark only). On-chain prices come from Jupiter. Tessera tokens traded **above** mark: T-OpenAI $974 vs $813 mark.
