# P0 acceptance tracker

Checklist 0.4: *Turn the spec's P0 acceptance criteria into tracked tickets, one per checkbox.* Each row below is one checkbox from `product-v2.md` → "Requirements → P0", in order. When a ticket system exists, import this table as-is; the IDs are stable.

**Status:** ✅ done and verified · 🟡 built, not yet verified end to end (reason given) · 🔶 partial · ⛔ blocked on an external account or decision · ⬜ not started.

**Evidence:** `vault/tests/src/<file>` (LiteSVM program tests), `backend/test/<file>` (backend tests), "live" (run through the real stack on localnet: web → backend → program), "mock" (web in mock-API mode, checked in a browser).

*As of 22 Sep 2026.*

## Sign in and wallet

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-001 | Sign in with email, Google, Apple or X through Privy, or with an external Solana wallet (Phantom, Solflare, Backpack) | ⛔ | Wired in `web/src/auth/PrivyAuthProvider`; needs a real `NEXT_PUBLIC_PRIVY_APP_ID`. Dev-keypair sign-in verified live. |
| BKT-002 | First email/social sign-in creates a self-custodial Solana wallet | ⛔ | Privy `createOnLogin` configured; needs the Privy app. |
| BKT-003 | Browsing needs no sign-in; sign-in only to create, invest or make a PnL card | ✅ | Server-rendered `/b/[slug]`; `SignInGate` / `requireSignIn` on actions (mock + live). |
| BKT-004 | "Add funds": deposit address + QR, external transfer, card/bank via Privy funding | 🔶 | Deposit address + QR and faucet verified live; card/bank needs Privy funding enabled. |
| BKT-005 | Every transaction confirmed in an in-app sheet with action and USD amount | ✅ | Publish verified live ($25.00, 4 transactions); invest/redeem/edit/close in mock. |
| BKT-006 | Bucket sponsors network fees; the user never holds SOL | ✅ | Live: a wallet with 0 SOL published a bucket; fee payer signs every tx. |
| BKT-007 | Export wallet key from settings at any time | 🟡 | Dev key reveal verified; Privy `exportWallet` wired, needs the Privy app. |
| BKT-008 | Link X; linked handle shows as verified | ⛔ | Badge rendering done (only when `xVerified`); linking needs Privy. |
| BKT-009 | Wallet-only users can add an email for notifications | ✅ | `POST /v1/me/notifications` (backend `api.test.ts`) + account screen. |

## Asset catalog

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-010 | One searchable catalog merging xStocks, PreStocks, Tessera with ticker, company, mint, source, type, live price | ✅ | Live sync: 161 xStocks + 8 PreStocks + 3 Tessera; builder search verified live. |
| BKT-011 | Sync at least hourly; a token that disappears is flagged, never silently dropped | ✅ | `catalog` job hourly; flagging in `backend/test/catalog.test.ts`; a failed Tessera fetch flagged nothing (live). |
| BKT-012 | Source and pre-IPO label in the builder, bucket page and confirmation | ✅ | Live builder + bucket page; confirmation shows the not-shares notice with tickers. |
| BKT-013 | Pre-IPO tokens show on-chain price and issuer mark | ✅ | Live bucket page: pSPACEX token $116.46 vs mark $154.58 (−25%). |
| BKT-014 | Unit price, returns and commission use the on-chain token price | ✅ | Program values with `Asset` prices; backend performance uses on-chain prices. |
| BKT-015 | Only tokens above the liquidity floor; pre-IPO capped at 25%, public at 50% | ✅ | Caps: `rules.test.ts`; floor: backend eligibility ($250k), 48 eligible of 203 live. |
| BKT-016 | Pre-IPO buckets say "not shares" on the confirmation screen | ✅ | `NotShares` component, wording from `docs/legal/not-shares-notice.md` (mock + live builder). |

## Create a bucket

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-017 | Search by ticker or company with live price | ✅ | Live ("anthropic" → pANTHROPIC $1,039.47). |
| BKT-018 | Whole-percent weights, 2–50% (25% pre-IPO), sum 100% before continuing | ✅ | On-chain `rules.test.ts`; live builder validation ("10% over"). |
| BKT-019 | "Equal weight" | ✅ | Live (4 × 25%). |
| BKT-020 | Commission fixed at 20%; creator does not set it | ✅ | `Config.commission_bps`, admin-only. |
| BKT-021 | Creator deposits ≥ $25 in the same flow; no creator money → cannot publish | ✅ | On-chain gate (bucket opens only after the creator's order fully fills; `review.test.ts` F1); live publish with $25. |
| BKT-022 | Publishing writes recipe, creates mint + vault, mints first tokens, opens the Meteora pool, returns a share link | 🔶 | All live except the pool (checklist 2.2; spike in `spikes/meteora-pool.md`). UI no longer claims a pool was opened. |
| BKT-023 | At most 5 active public buckets per wallet | ✅ | `rules.test.ts`. |

## Invest in a bucket

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-024 | USD amount, minimum $1, from USDC in the Bucket or a connected wallet | ✅ | On-chain minimum (`rules.test.ts`); invest modal. |
| BKT-025 | Quote mint and pool routes, use the cheaper | 🔶 | Mint route live; pool route "unavailable" until pools exist (2.2). |
| BKT-026 | Mint buys every stock in the vault's current proportions; pro-rata tokens; backer pays unit price + swap costs | ✅ | `loop.test.ts`, `invariant.test.ts` (no dilution across 60 random ops). |
| BKT-027 | Confirmation shows tokens received, effective price vs unit, swap cost, how the 20% works | ✅ | Invest modal (mock, screenshot-checked), incl. mint fee and rent rows. |
| BKT-028 | One confirmation; multi-transaction mints show "filling" and deliver tokens per leg | ✅ | Keeper fills legs (live: the creator's publish order filled); Filling UI in mock. |
| BKT-029 | A failed or >1% slippage leg returns unfilled USDC | ✅ | `failures.test.ts` (slippage, failed swap, zero liquidity); keeper closes and refunds. |
| BKT-030 | Amounts too small for every leg route to the pool | ⬜ | Needs pools (2.2). Program handles $1 mints (smallest leg 2¢ fills). |

## Sell or redeem

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-031 | Exit any amount by the cheaper of redeem or pool | 🔶 | Redeem route done; pool route needs 2.2. |
| BKT-032 | Redeem burns tokens, sells the pro-rata slice; no lock-up, no exit fee | ✅ | `loop.test.ts`; `redeem_fee_bps = 0` (open product question in `decisions.md`). |
| BKT-033 | Exit screen shows proceeds and effective price before confirming | ✅ | Redeem modal (mock). |
| BKT-034 | Redeem works if the bucket is closed, creator inactive, pool empty, or the web app offline | ✅ | `rules.test.ts` (closed), `failures.test.ts` (stale prices, in-kind exit), `vault/scripts/cli.ts` (no Bucket services). |
| BKT-035 | Bucket tokens can be held anywhere, transferred, traded | ✅ | Classic SPL mint, no freeze authority. |

## Edit a bucket

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-036 | Add/remove/change weights under creation rules | ✅ | `edits.test.ts`; edit page (`/create?edit=`). |
| BKT-037 | Each edit is a new version with timestamp and ≤140-char note | ✅ | `EditProposed` / `EditActivated` events; version history. |
| BKT-038 | Effective 24h after submitting; the bucket page shows the pending change | ✅ | `edits.test.ts`; pending-edit banner + diff (mock). |
| BKT-039 | At most one edit per 7 days | ✅ | `edits.test.ts`. |
| BKT-040 | On effect, the keeper rebalances once for all holders within slippage | 🟡 | Program `rebalance` tested; keeper rebalance is behind `KEEPER_REBALANCE`, not yet run on-chain. |
| BKT-041 | A holder can redeem or sell during the 24h window | ✅ | Redeem is never gated. |
| BKT-042 | Every backer notified when proposed and when effective (in-app, email or Telegram) | 🔶 | In-app done and tested; email/Telegram need `RESEND_API_KEY` / `TELEGRAM_BOT_TOKEN`. |
| BKT-043 | Name and thesis editable; history never editable or resettable | ✅ | `update_bucket_info` (`rules.test.ts`); no instruction touches history. |

## Performance

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-044 | Bucket page: unit price chart, 7/30/90/all returns, max drawdown, total backed, holders, age, pool price + premium | 🔶 | All live except pool price (null until 2.2). |
| BKT-045 | Holdings table: stock, target weight, contribution | ✅ | Live bucket page. |
| BKT-046 | Version history with before/after weights | ✅ | Bucket page (mock + live v1). |
| BKT-047 | Holder sees tokens, value, gain in USD and % vs what they paid | ✅ | Backend cost basis (`costBasis.test.ts`); portfolio + position panel. |

## Leaderboard

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-048 | Ranks public buckets by return for 7/30/90/all; default 30 days | ✅ | `leaderboard` job + web period switch. |
| BKT-049 | Rank, name, creator, return, max drawdown, total backed, backers | ✅ | Leaderboard view. |
| BKT-050 | Only eligible buckets ranked | 🟡 | Rules built and tested behind `LEADERBOARD_ENFORCE_ELIGIBILITY` (Phase 2 by the checklist). |
| BKT-051 | Updates at least hourly | ✅ | Hourly job. |

## Share link

| ID | Criterion | Status | Evidence / what's left |
| --- | --- | --- | --- |
| BKT-052 | Permanent URL `bucket.xyz/b/<slug>` | 🔶 | Route and permanent slugs done; the domain is not registered yet. |
| BKT-053 | Page fully readable without signing in | ✅ | Server-rendered. |
| BKT-054 | Preview card on X, WhatsApp, Telegram and iMessage (name, creator, 30-day return, top 3) | 🟡 | OG image renderer + meta tags done; needs a public URL to verify in each app. |
| BKT-055 | Share button copies the link and offers native share on mobile | ✅ | Bucket page share bar (mock). |
| BKT-056 | PnL card: bucket, creator, period, % return, QR + short link | ✅ | Web card + backend renderer (`cards.test.ts`); real QR. |
| BKT-057 | Save as image or share to X/WhatsApp/Telegram; dollars only when switched on | ✅ | Save produced a PNG (mock); dollar toggle off by default. |

## Summary

42 ✅ · 4 🟡 · 7 🔶 · 3 ⛔ · 1 ⬜ of 57.

- **Blocked on accounts:** the Privy app (BKT-001, 002, 008, and parts of 004 and 007) and the domain (BKT-052).
- **Waiting on Meteora pools** (checklist 2.2): BKT-022, 025, 030, 031, 044.
- **Still to run end to end:** the rebalance keeper (BKT-040), eligibility enforcement (BKT-050), preview cards in real apps (BKT-054).
