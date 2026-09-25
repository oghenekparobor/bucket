# Bucket — Architecture and Contracts

Engineering companion to `product-v2.md` (the spec) and `execution-checklist.md`. This file is the contract between the three products in this repo. If code and this file disagree, fix one of them in the same change.

```
bucket/
  vault/      On-chain: Anchor workspace (bucket_vault program, mock_swap devnet venue), TS SDK, tests, deploy scripts
  backend/    API, catalog + price service, indexer, performance + leaderboard jobs, keeper, card renderer
  web/        Next.js app (Privy sign-in, builder, bucket page, invest/redeem, portfolio, leaderboard, PnL card)
  design/     Imported Claude Design source (Bucket.dc.html) — the visual reference for web/
  docs/       Spec, checklist, this file, spikes, decisions, legal drafts
```

Package manager: pnpm workspace (`vault/sdk`, `vault/tests`, `backend`, `web`). Node 22. Anchor 0.32.1, Solana CLI 3.1.

---

## 1. Units and conventions (everyone)

| Quantity | Representation |
| --- | --- |
| USD amounts | integer micro-dollars (`e6`), `u64` on-chain, `bigint`/string in TS, `NUMERIC(38,0)` in Postgres. USDC has 6 decimals, so 1 USDC base unit = 1 micro-dollar |
| Token amounts | raw base units of the mint (`u64`). Decimals come from the mint |
| Asset price | `price_e6`: micro-dollars per **one whole raw token** (10^decimals base units, *before* any Token-2022 scaled-UI multiplier). The price service converts UI prices: `price_raw = price_ui × multiplier` |
| Bucket token | 6 decimals, classic SPL Token program, mint authority = bucket PDA |
| Unit price | `unit_price_e6 = vault_value_e6 × 10^6 / supply` (micro-dollars per whole bucket token). Starts at `100_000_000` ($100) |
| Weights | basis points (`u16`), whole percentages only (multiples of 100), sum 10 000 |
| Timestamps | unix seconds (`i64`) |
| JSON over HTTP | USD as decimal strings with 2–6 dp (`"1250.50"`), percents as numbers (`31.4` = 31.4%), addresses base58 |

## 2. On-chain program: `bucket_vault`

### 2.1 Accounts

| Account | Seeds | Notes |
| --- | --- | --- |
| `Config` | `["config"]` | admin, keeper, price_authority, fee_wallet, usdc_mint, commission_bps (2000), platform_share_bps (2000), mint_fee_bps (20), redeem_fee_bps (0), min_creator_deposit (25e6), min_deposit (1e6), min/max holdings (2/15), min_weight_bps (200), max_weight_public_bps (5000), max_weight_pre_ipo_bps (2500), max_active_buckets (5), max_slippage_bps (100), vault_cap_e6 (0 = none), order_ttl_secs, max_price_age_secs, max_price_move_bps, twap_window_secs, edit_delay_secs (86400), edit_cooldown_secs (604800), swap_programs[4], mints_paused |
| `Asset` | `["asset", mint]` | The allow-list entry **and** its price feed: mint, token_program, decimals, source (XStocks/PreStocks/Tessera), asset_type (PublicStock/Etf/PreIpo), enabled, flagged, extra_cost_bps (issuer transfer fee allowance), price_e6, twap_e6, last_price_ts, symbol |
| `CreatorState` | `["creator", creator]` | next bucket id, active bucket count |
| `Bucket` | `["bucket", creator, id_u32_le]` | creator, id, status (Open/Closed), token_mint, hwm_e6, version, holdings `Vec<Holding{mint, vault, decimals, weight_bps, reserved}>`, name (≤48 B), thesis (≤280 B), created_at, creator_funded, last_settled_at, last_edit_at, pending edit (holdings, effective_at, note ≤140 B) |
| Bucket token mint | `["bucket_mint", bucket]` | authority = bucket PDA |
| Vault token accounts | ATA(owner = bucket PDA, mint, token program of the mint) | Created by the client (creator pays) before `create_bucket`. Program checks the canonical address on every use |
| Commission fee accounts | `["creator_fee", bucket]`, `["platform_fee", bucket]` | Program-owned bucket-token accounts that commission is minted into; emptied by `claim_fees` |
| `MintOrder` | `["mint_order", bucket, backer, nonce_u64_le]` | backer, unit_price_e6 snapshot, usdc_total, legs `Vec<MintLeg{mint, budget, spent, price_e6, qty, tokens, done}>`, expires_at |
| Mint escrow | ATA(owner = MintOrder PDA, USDC) | Holds the backer's USDC until legs fill |
| `RedeemOrder` | `["redeem_order", bucket, holder, nonce_u64_le]` | holder, unit_price_e6, tokens_burned, legs `Vec<RedeemLeg{mint, qty, sold, usdc_out, claimed, done}>` |

`reserved` on a holding is the quantity burned-and-owed to open redeem orders. Vault value always uses `balance - reserved`.

### 2.2 Instructions

| Instruction | Signer | Summary |
| --- | --- | --- |
| `initialize_config(params)` | program upgrade authority | Creates `Config` |
| `update_config(params)` | admin | Replaces tunables. Cannot touch redeem |
| `add_asset(source, asset_type, symbol, extra_cost_bps, price_e6)` | admin | Creates `Asset` for a mint |
| `set_asset_status(enabled, flagged, extra_cost_bps)` | admin | `enabled=false` blocks new buckets/edits using it. Never touches existing buckets |
| `update_price(price_e6)` | price_authority | Bounded by `max_price_move_bps` vs TWAP; updates TWAP |
| `force_price(price_e6)` | admin | Unbounded (splits, relisting). Resets TWAP |
| `create_bucket(name, thesis, weights_bps[])` | creator | remaining = `Asset` per holding, in order. Validates rules, creates token mint. Vault ATAs must already exist |
| `open_mint(amount_e6, nonce, rent_fee_e6)` | backer (+ payer) | `rent_fee_e6` (≤ $1, only when payer ≠ backer) repays a sponsor who fronted the backer's new token-account rent. Settles commission; creator's first mint ≥ $25 and nobody else can mint before it; others ≥ $1; takes the fee; escrows USDC; snapshots unit price and per-leg budgets (current vault value proportions, or target weights when supply is 0). remaining = `[asset_i, vault_ata_i]` per holding |
| `fill_mint(leg, usdc_in, min_out, swap_data)` | keeper **or** backer | CPIs an allow-listed swap program signed by the order PDA; verifies escrow debit ≤ usdc_in, vault credit ≥ min_out and within slippage (+ asset extra_cost) of the reference price; issues `min(qty×price, spent) / unit_price` tokens to the backer. remaining = swap accounts |
| `close_mint_order()` | backer any time, keeper any time, anyone after expiry | Refunds unspent USDC to the backer, closes order and escrow |
| `redeem(tokens, nonce)` | holder | Settles commission; burns tokens; reserves `floor(available_i × tokens / supply)` of every holding for the holder. Works when the bucket is closed. remaining = `[asset_i, vault_ata_i]` |
| `fill_redeem(leg, qty, min_usdc_out, swap_data)` | keeper **or** holder | CPIs swap signed by the bucket PDA from the vault ATA to the holder's USDC. Guard rejects any other bucket-owned token account or the bucket mint among CPI accounts; checks source delegate/close authority unchanged |
| `claim_redeem_in_kind(leg)` | holder | Sends the unsold reserved quantity straight to the holder's own token account. Needs nothing but the chain |
| `close_redeem_order()` | holder, or anyone when all legs are done | Closes the order |
| `settle_commission()` | anyone | Values the vault at `min(spot, twap)` per asset; if unit price > hwm: commission = 20% × (U − H) × S; mints `F = C × S / (V − C)` tokens split creator 80 / platform 20; hwm := new unit price |
| `close_bucket()` | creator | Blocks new mints; redeem stays open; frees a creator slot |
| `update_bucket_info(name, thesis)` | creator | Name and thesis only; history is never editable |
| `create_token_metadata(uri)` | creator / admin / keeper | Metaplex metadata for the bucket mint: name and ticker on chain, `uri` for the rest. The mint authority is the bucket PDA, so only the program can write it; the update authority stays the bucket PDA. The ticker is derived from the name (letters and digits, uppercased, 10 max) |
| `update_token_metadata(uri)` | creator / admin / keeper | Rewrites that metadata after a rename |
| `claim_fees(creator)` | creator / anyone | Moves commission tokens from the program-owned fee account to the creator or the platform fee wallet |
| `propose_edit(weights_bps[], note)` | creator | Phase 2. Same rules as create; 7-day cooldown; effective in 24h. Creates any new vault ATAs with creator as payer |
| `admin_propose_removal(mint)` | admin | Phase 2. Force-remove a delisted token with the same 24h notice |
| `activate_edit()` | anyone | Phase 2. After effective time; version += 1 |
| `rebalance(from, to, qty_in, min_out, swap_data)` | keeper | Phase 2. Only from an over-weight to an under-weight holding, within slippage |

**Nobody has a path to move vault assets anywhere except:** swap legs whose output lands back in the vault (`rebalance`), in the backer-owned mint flow (`fill_mint` spends only the order escrow), or to the redeeming holder (`fill_redeem`, `claim_redeem_in_kind`). Tests enforce this.

### 2.3 Events (Anchor `emit!`, parsed by the indexer)

`ConfigUpdated`, `AssetAdded`, `AssetUpdated`, `PriceUpdated{mint, price_e6, twap_e6, ts}`, `BucketCreated{bucket, creator, id, token_mint, name, thesis, holdings[(mint, weight_bps)], ts}`, `BucketInfoUpdated{bucket, name, thesis, ts}`, `MintOpened{order, bucket, backer, amount_e6, fee_e6, net_e6, rent_fee_e6, unit_price_e6, legs[(mint, budget)], ts}`, `MintFilled{order, bucket, backer, leg, mint, usdc_spent, qty, tokens, vault_balance, supply, ts}`, `MintClosed{order, bucket, backer, refunded_e6, tokens_total, ts}`, `Redeemed{order, bucket, holder, tokens_burned, fee_tokens, unit_price_e6, legs[(mint, qty)], supply, settled, ts}`, `RedeemFilled{order, bucket, holder, leg, mint, qty_sold, usdc_out, vault_balance, ts}`, `RedeemClaimed{order, bucket, holder, leg, mint, qty, vault_balance, ts}`, `RedeemClosed`, `CommissionSettled{bucket, vault_value_e6, supply_before, unit_price_before_e6, hwm_before_e6, commission_e6, creator_tokens, platform_tokens, hwm_after_e6, ts}`, `FeesClaimed{bucket, recipient, creator, tokens, ts}`, `BucketClosed`, `EditProposed{bucket, version, holdings, note, effective_at, forced}`, `EditActivated{bucket, version, holdings}`, `Rebalanced{bucket, from_mint, to_mint, qty_in, qty_out, from_balance, to_balance, ts}`.

Every event that changes a vault balance carries the post-change balance, and every event that changes supply carries the post-change supply, so the indexer can rebuild vault state and unit price history from events plus `PriceUpdated`.

### 2.4 Swap venues

`fill_mint`, `fill_redeem` and `rebalance` CPI into a program from `Config.swap_programs`:

- **devnet / tests:** `mock_swap` — one `Market` per mock stock at a pushed price with a fee. It holds mint authority of the mock mints and mock USDC, so liquidity is unlimited. Also exposes `faucet` for testers.
- **mainnet:** Jupiter v6. The keeper (or a holder) fetches a route and passes the swap instruction's data and accounts through.

The SDK exposes one `SwapAdapter` interface with a mock and a Jupiter implementation.

### 2.5 TypeScript SDK (`@bucket/sdk`, `vault/sdk`)

PDA helpers, typed account fetchers, instruction builders for every instruction above, flow builders that return ready-to-sign instruction lists (create bucket incl. vault ATAs and lookup table, open mint, fill, redeem, claim, settle), an event parser, and pure math mirroring the program (`valueVault`, `unitPrice`, `commission`, `quoteMint`, `quoteRedeem`). Backend and web depend on it; nothing else talks to the program directly.

---

## 3. Backend API (`backend/`, base path `/v1`)

Fastify + Postgres. Public reads need no auth. Writes need `Authorization: Bearer <Privy access token>`; the API verifies it and maps the Privy user to their Solana wallet. In dev (`AUTH_MODE=dev`) the bearer is `dev:<wallet>:<unix_ts>:<ed25519 signature of "bucket-dev-auth:<wallet>:<unix_ts>">`, so the whole loop runs without a Privy app.

Shared shapes:

```ts
type Source = 'xStocks' | 'PreStocks' | 'Tessera';
type AssetType = 'public_stock' | 'etf' | 'pre_ipo';
type Period = '7d' | '30d' | '90d' | 'all';

interface CatalogToken { mint: string; ticker: string; name: string; source: Source; assetType: AssetType;
  price: string; markPrice: string | null; liquidityUsd: string | null; decimals: number; logo: string | null;
  eligible: boolean; flagged: boolean; maxWeightPct: number;
  eligibilityReason: string | null;   // e.g. below_liquidity_floor, unpriced, issuer_conversion_deadline
  deadline: string | null; }          // issuer expiry / redemption deadline, ISO

interface CreatorRef { wallet: string; displayName: string | null; xHandle: string | null; xVerified: boolean; }

interface BucketSummary { address: string; slug: string; name: string; creator: CreatorRef; status: 'open' | 'closed';
  unitPrice: string; returns: Record<Period, number | null>; maxDrawdown: number; totalBacked: string;
  holders: number; ageDays: number; topHoldings: { ticker: string; weightPct: number }[]; eligible: boolean; }

interface Holding { mint: string; ticker: string; name: string; source: Source; assetType: AssetType;
  weightPct: number; price: string; markPrice: string | null; markGapPct: number | null;
  contributionPct: number | null; balance: string; valueUsd: string; }

interface BucketDetail extends BucketSummary { thesis: string; createdAt: string; version: number;
  tokenMint: string; vault: string; supply: string; hwm: string; poolPrice: string | null; premiumPct: number | null;
  holdings: Holding[]; preIpoSharePct: number;
  versions: { version: number; activatedAt: string; holdings: { ticker: string; weightPct: number }[]; note: string | null; changeSummary: string }[];
  pendingEdit: null | { version: number; effectiveAt: string; note: string | null;
    diff: { ticker: string; fromPct: number | null; toPct: number | null }[] };
  lastSettledAt: string | null; eventCount: number; shareUrl: string;
  fundingState: 'awaiting_creator' | 'open' | 'closed'; }   // awaiting_creator until a creator mint order fills every leg
```

JSON conventions as implemented: token amounts (`supply`, `tokens`, `balance`, `tokensOut`, the redeem `tokens` input) are **raw base-unit integer strings**; per-token prices 6 dp; USD totals 2 dp; percents are numbers. `price` / `markPrice` are per **UI** unit (what wallets show); valuations use the raw price (UI × Token-2022 scaled-UI multiplier), so use `valueUsd` rather than `balance × price`. `returns[period]` is `null` when the bucket is younger than the period; `maxDrawdown` is since creation. Errors are `{ error, message, details }`.

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | `/v1/health` | – | `{ ok, cluster, programId, lastSync }` |
| GET | `/v1/catalog?q=&source=` | – | `{ tokens: CatalogToken[], syncedAt }` |
| GET | `/v1/stats` | – | `{ totalBacked, bucketCount, backers, commissionPaid, creatorsPaid, medianPoolGapPct, shareLinkBackerPct }` |
| GET | `/v1/leaderboard?period=30d` | – | `{ period, updatedAt, rows: (BucketSummary & { rank, return, spark: number[] })[] }` |
| GET | `/v1/buckets/:slugOrAddress` | – | `BucketDetail` |
| GET | `/v1/buckets/:slugOrAddress/token.json` | – | Metaplex off-chain metadata (`name`, `symbol`, `description`, `image`, `external_url`). What the on-chain `uri` points at; served live so a rename needs no chain write |
| GET | `/v1/admin/jobs` | admin bearer (`ADMIN_TOKEN`) | Every worker job with its last run. 503 until the token is configured |
| POST | `/v1/admin/jobs/:name` | admin bearer (`ADMIN_TOKEN`) | Runs one worker job now (`catalog`, `indexer`, `prices`, `price-push`, `token-metadata`, ...) and returns its result; recorded in `job_runs` like a scheduled run |
| POST | `/v1/admin/tick` | admin bearer (`ADMIN_TOKEN`) | Runs every job that is due by the worker's schedule (`{force:true}` runs all, `{jobs:[...]}` narrows, `{keeper:true}` adds one lease-safe keeper pass). What a scheduler calls every minute in place of the worker and keeper services |
| GET | `/v1/buckets/:slug/chart?period=` | – | `{ points: { t: string, unitPrice: number, hwm: number }[] }` |
| GET | `/v1/creators/:wallet` | – | `{ creator: CreatorRef, buckets: BucketSummary[], totals }` |
| GET | `/v1/quote/mint?bucket=&amount=` | – | `{ routes: [{ kind: 'mint' \| 'pool', available, tokensOut, effectivePrice, effectiveVsUnitPct, costUsd }], chosen, feeUsd, rentUsd, legs, unitPrice }` |
| GET | `/v1/quote/redeem?bucket=&tokens=` | – | same shape, `usdcOut` instead of `tokensOut` |
| GET | `/v1/orders/:address` | – | `{ kind: 'mint' \| 'redeem', status: 'open' \| 'filling' \| 'done' \| 'refunded', legs: { ticker, weightPct, status: 'queued' \| 'swapping' \| 'filled' \| 'failed' \| 'claimed' }[], tokens, usdc }` |
| GET | `/og/b/:slug.png` | – | 1200×630 share preview card |
| GET | `/og/pnl/:slug.png?period=&wallet=&dollars=0` | – | 1080×1350 PnL card |
| GET | `/v1/me` | ✓ | `{ userId, wallet, email, xHandle, xVerified, usdcBalance, solBalance }` |
| GET | `/v1/me/portfolio` | ✓ | `{ positions: { bucket: BucketSummary, tokens, unitPrice, value, paid, gainUsd, gainPct }[], totals: { value, paid, gainUsd, gainPct, commissionPaid } }` |
| GET | `/v1/me/dashboard` | ✓ | creator dashboard (backers by day, commission, funnel, own buckets) |
| POST | `/v1/tx/create-bucket` | ✓ | body `{ name, thesis, holdings: { mint, weightPct }[], stakeUsd }` → `{ transactions: string[] /* base64 v0, send in order; ones only Bucket signs are already complete and are relayed as-is */, bucket, slug, order /* the creator's first mint */ }` The response also carries `optional`: indices of transactions whose failure must not fail the publish (the token metadata one, backfilled by the keeper). |
| POST | `/v1/tx/mint` | ✓ | `{ bucket, amountUsd }` → `{ transaction, order }` |
| POST | `/v1/tx/redeem` | ✓ | `{ bucket, tokens }` → `{ transaction, order }` |
| POST | `/v1/tx/close-bucket` | ✓ | `{ bucket }` → `{ transaction }` |
| POST | `/v1/tx/update-info` | ✓ | `{ bucket, name, thesis }` → `{ transaction }` |
| POST | `/v1/tx/propose-edit` | ✓ | `{ bucket, holdings, note }` → `{ transaction }` |
| POST | `/v1/tx/submit` | ✓ | `{ transaction /* base64, user-signed */ }` → `{ signature }`; nudges the keeper |
| POST | `/v1/faucet` | ✓ | devnet only: mock USDC to the caller |
| POST | `/v1/me/notifications` | ✓ | `{ email?, telegramChatId? }` |
| GET | `/v1/me/notifications` | ✓ | in-app notifications (edit proposed / took effect) |
| POST | `/v1/events/link-click` | – | `{ slug, ref }` share-link attribution |
| POST | `/v1/webhooks/privy` | signature | Privy pushes user events here (svix-signed). Verified with `PRIVY_WEBHOOK_SECRET`, applied once per delivery id, and only ever updates profile details: wallet, email, X handle, and erasure on `user.deleted`. The wallet a transaction is built for still comes from the access token on that request |

**Geo-restrictions:** `/v1/tx/*` returns **451** for a country in `blockAll`, and for `blockPreIpo` when the bucket holds a pre-IPO token (`backend/config/geo-restrictions.json`, from `docs/legal/geo-restrictions.md`). `/v1/tx/redeem` is never blocked: exits always work.

Transactions are built server-side with the SDK, with the Bucket fee payer as fee payer (network fees sponsored), partially signed, and returned for the user to sign with their Privy or external wallet. The SDK and `vault/scripts/cli.ts` can build the same transactions locally, so an exported key can always redeem with no Bucket service running.

## 4. Web (`web/`)

Next.js (App Router). Routes: `/` leaderboard, `/b/[slug]` bucket page (server-rendered, OG tags point at `/og/b/:slug.png`), `/create`, `/portfolio`, `/dashboard`, `/account`, `/creator/[wallet]`. Modals: invest (form → filling → done), sell/redeem, pending edit, PnL card, published. Visual language, copy and layout come from `design/Bucket.dc.html`.

## 5. Environments

| | devnet preview | mainnet |
| --- | --- | --- |
| Assets | Mock Token-2022 mints mirroring catalog prices (one mock PreStock carries a 1% transfer fee like the real ones) | xStocks, PreStocks, Tessera |
| USDC | mock USDC (classic SPL, 6 dp) with faucet | USDC |
| Swap venue | `mock_swap` | Jupiter |
| Prices | backend mirrors mainnet prices into `Asset` and `mock_swap` markets | backend pushes oracle / TWAP prices |
