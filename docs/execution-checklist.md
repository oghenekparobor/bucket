# Bucket — Execution Checklist

Companion to `bucket-product-spec.md` (21 Sept 2026). The spec says what to build. This says in what order, who does it, and how you know each phase is finished.

**How to use it**

- Work top to bottom. Phase 0 unblocks everything else, so do not start the program until its decisions are made.
- Each item has an owner tag: **Product**, **Legal**, **Design**, **Program** (on-chain), **Backend** (API, indexer, keeper), **Web**, **Ops**.
- Each phase ends with an exit gate. Nothing from the next phase ships until the gate passes.
- The spec's P0 acceptance criteria are the test plan. This checklist does not repeat them. It points to them.

---

## Phase 0: Decide and set up

### 0.1 Decisions that block the build

- [ ] **Product** Decide the commission split: creator keeps the full 20%, or platform keeps 20% of it (spec assumption) — _open — build defaults to the spec assumption, changeable in `Config` ([decisions.md](decisions.md))_
- [ ] **Product** Confirm the 0.20% fee on mints and redeems — _open — mint 0.20% in `Config`; redeem 0 because P0 says "no exit fee"; the spec contradicts itself here_
- [ ] **Product** Decide who seeds each bucket's Meteora pool and with how much: creator, platform, or both — _open — sizing data in [spikes/meteora-pool.md](spikes/meteora-pool.md)_
- [ ] **Product** Set the smallest amount that mints through the vault. Anything below it routes to the pool — _open — program minimum $1; see pool spike for sizing_
- [ ] **Product** Confirm weight caps: 50% public stock, 25% pre-IPO token — _open — built as specified, in `Config`_
- [ ] **Product** Decide whether a linked X account is required to appear on the leaderboard — _open — not required today_
- [ ] **Product** Decide the fee sponsorship policy: every transaction forever, or a cap per user — _open — sponsoring every transaction today_
- [x] **Program + Backend** Choose how `settle_commission` values the vault: oracle for public stocks, time-weighted DEX price with bounds for pre-IPO tokens — decided: pushed prices clamped ±20% of an on-chain TWAP, commission at min(spot, TWAP) ([decisions.md](decisions.md) #2)
- [x] **Backend** Set the liquidity floor for the catalog and count how many xStocks, PreStocks and Tessera tokens pass it today — $250k floor: 19 xStocks, 4 PreStocks, 1 Tessera pass ([spikes/catalog-and-routing.md](spikes/catalog-and-routing.md))
- [x] **Program** Decide the devnet approach: mock mints with mirrored prices, since the real tokens exist on mainnet only — decided: one mock Token-2022 mint per real token, same decimals and transfer fee, prices mirrored ([decisions.md](decisions.md) #1)

### 0.2 Legal groundwork

- [ ] **Legal** Engage counsel with tokenized-securities and fund experience — _counsel brief ready to send ([legal/counsel-brief.md](legal/counsel-brief.md))_
- [ ] **Legal** Get a written view on the pooled vault: which jurisdictions Bucket can serve, and what licence or exemption applies
- [ ] **Legal** Get a written view on creators earning a 20% performance commission
- [ ] **Legal** Read the xStocks, PreStocks and Tessera terms. Confirm a program-owned vault may hold their tokens and issue a token against them — _terms read and summarized with 20 open questions for counsel ([legal/issuer-terms.md](legal/issuer-terms.md)); the confirmation itself needs counsel_
- [x] **Legal** Collect each issuer's restricted-country list and draft Bucket's geo-restriction list from the strictest of them — draft for counsel: 61 countries, stricter list for pre-IPO buckets, machine-readable ([legal/geo-restrictions.md](legal/geo-restrictions.md))
- [x] **Legal** Draft Terms of Service, risk disclosures, the past-performance notice, and the "pre-IPO tokens are not shares" wording — drafts in [legal/](legal/), not yet reviewed by counsel

### 0.3 Technical spikes

- [ ] **Program** Confirm the token program and any transfer restrictions, freeze authority or transfer hooks on xStocks, PreStocks and Tessera tokens, and that a PDA can hold and swap them — _restrictions confirmed on mainnet ([spikes/token-programs.md](spikes/token-programs.md)); PDA hold/swap proven on Token-2022 mocks, not yet with real tokens on mainnet_
- [x] **Program** Prototype a proportional mint into a 15-holding vault. Measure how many transactions it takes and what a failed leg looks like — 4 txs, one user signature ([spikes/fifteen-holding-mint.md](spikes/fifteen-holding-mint.md))
- [x] **Program** Prototype creating a Meteora DAMM v2 pool for a program-minted token against USDC, using the Meteora SDK — created and swapped on devnet ([spikes/meteora-pool.md](spikes/meteora-pool.md))
- [x] **Backend** Prototype swap routing for every catalog token through the chosen aggregator. Record the minimum tradeable size per token — 96 priced tokens, 388 live Jupiter quotes ([spikes/catalog-and-routing.md](spikes/catalog-and-routing.md))
- [x] **Backend** Pull `prestocks.com/api/prestocks` and map its fields to the catalog schema — mapping table in [spikes/catalog-and-routing.md](spikes/catalog-and-routing.md)
- [x] **Backend** Get Tessera's `token-details` endpoint working. Document fields, rate limits, uptime and whether a key is needed — works without a key; intermittent HTTP 500s (2 of 5 syncs, and again on 22 Sep) — sync treats a failed fetch as no data, never as delisting
- [ ] **Web** Prototype Privy sign-in with an auto-created Solana wallet, an external wallet, and key export — _wired in `web/src/auth`; needs a Privy app id to run_

### 0.4 Project setup

- [ ] **Ops** Register the domain and create the Privy app, RPC provider account, and repos for program, backend and web — _needs your accounts; code lives in one monorepo at the root (`vault/`, `backend/`, `web/`)_
- [ ] **Ops** Set up CI: program build and tests, backend tests, web build, preview deploys — _workflow written ([.github/workflows/ci.yml](../.github/workflows/ci.yml)); not run — needs a GitHub repo, and Vercel secrets for previews_
- [x] **Ops** Create devnet wallets for deployer, keeper, fee payer and platform fees. Document who holds each key — [ops/keys.md](ops/keys.md)
- [x] **Product** Turn the spec's P0 acceptance criteria into tracked tickets, one per checkbox — 57 tickets with status and evidence ([p0-tracker.md](p0-tracker.md))

**Exit gate 0:** every 0.1 decision is written into the spec, counsel has not said "do not build this", and every 0.3 spike has a yes or a documented workaround.

---

## Phase 1: Devnet preview

Goal: a creator builds a bucket, a second wallet mints tokens from the link, redeems at a gain, and the creator receives commission tokens.

### 1.1 On-chain program

- [x] **Program** Create devnet mock mints for a sample of catalog tokens, plus mock USDC — 31 mock Token-2022 mints (one per real xStocks/PreStocks/Tessera token, same decimals and transfer fees) plus mock USDC, listed on devnet; addresses in `vault/deployments/devnet.json`
- [x] **Program** `Config` account: allowed mints with source and asset type, commission rate, fee rates, fee wallet, keeper authority, limits — allowed mints are one `Asset` account each (also the price feed)
- [x] **Program** `create_bucket`: 2 to 15 holdings, weights 2% to 50% (25% pre-IPO), sum to 100%, allowed mints only, at most 5 active buckets per wallet — `rules.test.ts`
- [x] **Program** `create_bucket` also creates the bucket token mint (program as sole mint authority) and the vault token accounts — vault ATAs are created by the client in the same publish flow and pinned in the bucket
- [x] **Program** `mint`: settle commission first, take USDC, buy every holding in the vault's current proportions, issue tokens pro rata, charge the 0.20% fee — `open_mint` + `fill_mint`
- [x] **Program** Enforce the $25 minimum on the creator's first mint and the $1 minimum on all others
- [x] **Program** `fill`: complete a multi-transaction mint within the slippage bound. Return unfilled USDC to the backer — `fill_mint` + `close_mint_order`
- [x] **Program** `redeem`: settle commission first, burn tokens, sell the pro-rata slice, pay USDC. Must work when the bucket is closed — `redeem` + `fill_redeem`, plus keeper-free `claim_redeem_in_kind`
- [x] **Program** `settle_commission`: value the vault, compare with the high-water mark, mint fee tokens split 80/20, move the mark up
- [x] **Program** `close_bucket`: block new mints, leave redeem open
- [x] **Program** Emit an event for every state change so the indexer can rebuild everything from chain history — 19 event types, post-change balances and supply included
- [x] **Program** Test: tokens in supply times unit price always equals vault value, across mints, redeems and settlements — `invariant.test.ts`, 60 random ops
- [x] **Program** Test: neither the creator nor the keeper has any instruction path that moves assets out of a vault — `security.test.ts`
- [x] **Program** Test: reproduce the spec's worked example exactly ($125 to $120, then $130 to $128, supply 1,041.67 then 1,057.94) — on-chain (`worked-example.test.ts`) and in Rust unit tests
- [x] **Program** Test: failed swap leg, slippage breach, zero-liquidity token, mint and redeem in the same slot, dust amounts — `failures.test.ts`
- [x] **Program** Deploy to devnet and publish the IDL — `bucket_vault` `GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29` and `mock_swap` `AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx` on devnet, IDL account `Efz93e79n3Cj8TojUw9qgsMeTp8z4tfPbPYxffrXfMeq`; the Phase 1 goal passes on devnet with two wallets (`vault/scripts/e2e.ts --cluster devnet`)

### 1.2 Backend and keeper

- [x] **Backend** Catalog sync from xStocks, PreStocks and Tessera, at least hourly. Flag tokens that disappear, never silently drop them — live on localnet; flagging unit-tested
- [x] **Backend** Price service: on-chain price for every token, plus the issuer's mark price for pre-IPO tokens — Jupiter on-chain prices (raw and UI, scaled-UI aware) + issuer marks
- [x] **Backend** Indexer for program events into the performance database — indexes every program event; `rebuild` replays from events
- [x] **Backend** Performance calculator: hourly unit price, returns for 7, 30, 90 days and since creation, max drawdown, contribution per holding
- [x] **Backend** Holder view: tokens held, current value, gain against what they paid through Bucket — average-cost basis incl. fees and rent
- [x] **Backend** Leaderboard job, hourly, by period, showing every bucket for now (eligibility rules come in phase 2)
- [ ] **Backend** API that verifies the Privy access token on every write and maps the user to their wallet address — _implemented and tested against a mocked Privy client; needs a real Privy app to verify_
- [x] **Backend** Preview card renderer for share links: name, creator, 30-day return, top 3 holdings
- [x] **Backend** PnL card renderer: bucket, creator, period, percent return, QR code and short link. Dollar amounts only when switched on
- [x] **Backend** Keeper: run `fill` for open mints and `settle_commission` at least daily. Alert when either fails — filled and settled live on localnet; randomized 12–24h settlement; standby keeper via a Postgres lease

### 1.3 Web app

- [ ] **Web** Privy sign-in: email, Google, Apple, X, and external wallets (Phantom, Solflare, Backpack) — _wired; needs a Privy app id. Dev-keypair sign-in works end to end_
- [x] **Web** Account screen: wallet address, USDC balance, deposit address with QR code, key export — verified live on localnet (key export via the dev key; Privy export wired)
- [x] **Web** In-app confirmation sheet for every transaction, stating the action and the USD amount — verified live on the publish flow
- [x] **Web** Bucket builder: search by ticker or company with live price, weight inputs, "equal weight", live validation of the weight rules — verified live
- [x] **Web** Source badge and pre-IPO label on every token. Both prices shown for pre-IPO tokens
- [x] **Web** Publish flow with the creator's first mint of at least $25 — published live on localnet, one signature
- [x] **Web** Bucket page: unit price chart, returns, drawdown, total backed, holders, age, holdings table — live data on localnet
- [x] **Web** Invest flow: amount, confirmation with tokens received, effective price, swap cost and how commission works, then "filling" state — mock-verified; keeper fills verified live
- [x] **Web** "Not shares" notice on the confirmation screen for buckets holding pre-IPO tokens — wording from the legal draft
- [x] **Web** Sell or redeem flow with proceeds and effective price before confirmation — mock-verified
- [x] **Web** Portfolio view across all buckets held
- [x] **Web** Leaderboard with period switch
- [x] **Web** Share link at `/b/<slug>`, readable without sign-in, with copy and native share — server-rendered with OpenGraph tags
- [x] **Web** PnL card: generate, save as image, share to X, WhatsApp and Telegram

### 1.4 Design

- [x] **Design** End-to-end flows for creator, backer and visitor on mobile and desktop — imported design (desktop + 3 phone screens) and [design/flows.md](design/flows.md)
- [ ] **Design** A plain-language explainer for the high-water-mark commission, tested on five people who do not know what one is — _explainer and test script written ([design/commission-explainer.md](design/commission-explainer.md)); the five-person test needs people_
- [x] **Design** Visual language for unit price against pool price, and for pre-IPO labels — in the imported design (`design/Bucket.dc.html`)
- [x] **Design** Preview card and PnL card templates — PnL card in the design; both templates rendered by the backend in the design language

**Exit gate 1:** the goal above works on devnet with two separate wallets, all 1.1 tests pass in CI, and five outside testers complete create, invest and redeem without help.

---

## Phase 2: Mainnet v1

Goal: all P0 acceptance criteria in the spec pass on mainnet, with capped deposits.

### 2.1 Edits and rebalancing

- [x] **Program** `propose_edit` with a 24-hour effective time and a 7-day minimum between edits — `edits.test.ts`
- [x] **Program** `activate_edit`, callable by anyone after the effective time
- [x] **Program** `rebalance`: keeper-only, toward active weights, slippage bound per trade, allowed mints only
- [x] **Program** Charge the creator the rent for any new vault token account an edit adds — new vault ATAs created in the creator's `propose_edit` tx, creator paying
- [ ] **Backend** Keeper runs `activate_edit` and `rebalance`. Alert on a rebalance that cannot complete within bounds — _wired and unit-tested; rebalance behind `KEEPER_REBALANCE`, not yet run on-chain_
- [x] **Web** Pending-edit banner on the bucket page for the full 24 hours, with before and after weights
- [x] **Web** Version history on every bucket page
- [ ] **Backend** Notifications when an edit is proposed and when it takes effect: in-app, email, Telegram — _in-app done; email/Telegram need Resend and Telegram keys_
- [x] **Web** Let wallet-only users add an email for notifications

### 2.2 Meteora pool per bucket

- [ ] **Program + Backend** Create a DAMM v2 pool of bucket token against USDC at publish, seeded per the phase 0 decision
- [ ] **Backend** Quote both routes for every buy and sell (mint or redeem, and the pool) and return the cheaper
- [ ] **Backend** Route amounts below the vault minimum to the pool
- [ ] **Backend** Index pool price. Compute premium or discount to unit price
- [ ] **Web** Show pool price and its premium or discount on every bucket page — _UI renders it when the API returns a pool price; no pools yet_
- [ ] **Backend** Alert when any bucket's pool price sits more than 1% from unit price for over an hour

### 2.3 Funding, fees and rent

- [ ] **Web** Card and bank purchase of USDC through Privy's funding providers, for the launch countries confirmed in phase 0
- [ ] **Backend** Sponsor network fees through Privy's gas management, within the sponsorship policy — _fees are sponsored today by Bucket's own fee payer; Privy gas management not used (needs the Privy app and the sponsorship decision)_
- [x] **Program + Backend** Front the rent for a new holder's bucket token account and recover it in USDC from their first mint — `rent_fee_e6` (≤ $1), charged by the backend when the fee payer creates the account; `rules.test.ts`

### 2.4 Leaderboard integrity

- [x] **Backend** Eligibility rules: 14 days minimum age and at least as old as the period, creator holds $25 continuously, every holding above the liquidity floor, public and open — built and tested; enforced when `LEADERBOARD_ENFORCE_ELIGIBILITY=true`
- [ ] **Backend** Monitor creator wallet trades in a bucket's holdings around its edits. Flag for review
- [x] **Web** Drawdown beside every return figure. Creator profile lists every bucket the wallet has made, including closed ones
- [x] **Web** Verified X handle on buckets and leaderboard rows — shown only when the account links X (linking needs Privy)

### 2.5 Safety and operations

- [x] **Program** Cap on vault size at launch, adjustable in `Config` — `vault_cap_e6`
- [ ] **Program** Time-weighted prices with bounds in `settle_commission`. Settlement at unpredictable times — _TWAP + clamp + min(spot, TWAP) done and tested; randomized settlement times are the keeper's job (backend)_
- [x] **Program** Admin path to force-remove a delisted token, with the same 24-hour notice as any edit — `admin_propose_removal`
- [ ] **Ops** Move program upgrade authority and `Config` authority to a multisig
- [ ] **Ops** Keeper and fee-payer key management, balance alerts, and a second keeper on standby
- [ ] **Ops** Monitoring and alerts: keeper failures, catalog sync failures, price feed gaps, pool price gaps, RPC errors
- [x] **Ops** Runbooks: keeper outage, Privy outage, token delisting, stuck mint, suspected manipulation, program pause decision — [ops/runbooks.md](ops/runbooks.md)
- [ ] **Ops** Public status page and a support channel

### 2.6 Security

- [x] **Program** Internal security review against a Solana program checklist: signer checks, PDA seeds, account ownership, arithmetic, CPI targets — independent review found 0 critical, 0 high, 1 medium and 2 low; the medium, both lows and two liveness edges are fixed with regression tests ([security/internal-review.md](security/internal-review.md))
- [ ] **Program** External audit of the full program. Fix every high and medium finding. Publish the report
- [ ] **Backend + Web** Review the API auth path, Privy token handling, and card renderer inputs
- [ ] **Ops** Open a bug bounty before mainnet deposits are uncapped

### 2.7 Legal and compliance

- [ ] **Legal** Written sign-off to launch in the chosen jurisdictions
- [x] **Web + Backend** Geo-restrictions live, including tighter rules for buckets holding pre-IPO tokens if counsel requires them — 451 on `/v1/tx/*` from the draft list, never on redeem; needs Cloudflare/Vercel country headers in production; the list itself awaits counsel
- [ ] **Web** Terms of Service, risk disclosures and past-performance notice live, with acceptance recorded at sign-up — _pages live as marked drafts; acceptance recorded in the browser and via Privy, not yet server-side_
- [ ] **Legal** Creator terms covering the commission, conduct rules, and what gets a bucket delisted

### 2.8 Launch

- [ ] **Program** Deploy to mainnet. Load `Config` with the liquidity-filtered allowed mints
- [ ] **Backend** Analytics for every success metric in the spec, with a dashboard
- [ ] **Product** Recruit 10 to 20 launch creators and have their buckets funded before public launch
- [ ] **Product** Run the full P0 acceptance criteria on mainnet with real money at small size
- [ ] **Ops** Launch with capped deposits. Write down the conditions for raising the cap

**Exit gate 2:** every P0 checkbox in the spec passes on mainnet, the audit report is published with no open high findings, legal sign-off is in hand, and the on-call rota and runbooks exist.

---

## Phase 3: Growth

Start only after exit gate 2. Order these by what the metrics say, not by this list.

- [x] **Web + Backend** Creator profile page: all buckets, combined total backed, lifetime record — built early because the design includes it (`/creator/[wallet]`, `GET /v1/creators/:wallet`)
- [x] **Web + Backend** Creator dashboard: holders over time, commission earned, link clicks to deposits — built early because the design includes it (`/dashboard`, `GET /v1/me/dashboard`)
- [ ] **Backend** Notifications for completed rebalances and commission paid
- [ ] **Backend + Web** Solana Blinks so a backer can invest from inside an X post
- [ ] **Program + Backend** Recurring deposits, weekly or monthly
- [ ] **Backend + Web** Risk-adjusted leaderboard tab
- [ ] **Backend** Referral attribution so a non-creator who shares a link earns a slice of platform fees

**Exit gate 3:** the P1 list is shipped and the lagging metrics are tracked against target.

---

## Standing reviews

- [ ] **Product** Weekly: leading metrics (creation completion, link-to-deposit time, sign-in rate, deposit rate, fill rate)
- [ ] **Product** Monthly: lagging metrics (outside backers, share-link share, 30-day holding, creators paid, total backed, pool price gap)
- [ ] **Product** After the first month on mainnet: revise every metric target against real data
- [ ] **Ops** Monthly: review alerts fired, incidents and runbook gaps
- [ ] **Legal** Quarterly: re-check issuer terms and the jurisdiction list