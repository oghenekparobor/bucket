# @bucket/backend

API, catalog and price service, chain indexer, performance and leaderboard jobs, keeper, notifications and
card renderer for Bucket. The contract with `web/` and `vault/` is [`docs/architecture.md`](../docs/architecture.md);
the REST shapes in §3 are implemented as written, plus a few additive fields listed below.

TypeScript (strict, ESM) on Node 22 · Fastify 5 · zod · Postgres (`pg`, plain SQL migrations) · vitest ·
satori + resvg for PNG cards · `@bucket/sdk` (web3.js v1, Anchor 0.32) for everything on-chain.

## Run it

```bash
# once: databases (Postgres on the default socket/port, current OS user)
createdb bucket_dev && createdb bucket_test
cp backend/.env.example backend/.env           # optional; defaults work for local dev

# design-like data with no chain at all: six buckets, creators and history from design/Bucket.dc.html
pnpm --filter @bucket/backend catalog:sync     # optional: live xStocks / PreStocks / Tessera catalog first
pnpm --filter @bucket/backend seed:fixtures    # synthetic program events → indexer projection → jobs
pnpm --filter @bucket/backend dev              # API on :4000 (AUTH_MODE=dev accepts dev bearer tokens)

# against the local validator (vault/scripts/localnet.sh + setup.ts), in three terminals
CLUSTER=localnet DATABASE_URL=postgres://localhost:5432/bucket_localnet pnpm --filter @bucket/backend dev
CLUSTER=localnet DATABASE_URL=postgres://localhost:5432/bucket_localnet pnpm --filter @bucket/backend worker
CLUSTER=localnet DATABASE_URL=postgres://localhost:5432/bucket_localnet pnpm --filter @bucket/backend keeper
API_URL=http://localhost:4000 pnpm --filter @bucket/backend smoke:localnet   # full create → mint → redeem flow
```

Every process runs pending migrations on start (serialized with an advisory lock). Other scripts:
`build`, `start` / `start:worker` / `start:keeper` (built), `typecheck`, `test`, `migrate`, `rebuild`,
`seed:wipe`, `prices:sync`, `perf:run`, `leaderboard:run`, `spike:routing`; any job by name with
`tsx scripts/runJob.ts <job>`.

## Processes

| Process | Entry | Does |
| --- | --- | --- |
| API | `src/server.ts` | Fastify app (`src/api/`), card PNGs, tx building and relay |
| Worker | `src/worker.ts` | Indexer every 3 s, then the jobs below on intervals, never overlapping |
| Keeper | `src/keeper/main.ts` | Fills, closes, settles, activates edits, rebalances; wakes on `NOTIFY keeper_nudge` from `/v1/tx/submit` |

| Job | Every | What |
| --- | --- | --- |
| `indexer` | 3 s | New `bucket_vault` transactions → `decodeEvents` (SDK) → `events` → projection; refreshes metrics of touched buckets |
| `catalog` | 1 h | xStocks (Jupiter search), PreStocks, Tessera → `assets`; flags tokens that disappear; prices; eligibility |
| `prices` | 5 min | Jupiter price v3 → `asset_prices` (raw and UI price, scaled-UI multiplier); SOL price; eligibility |
| `price-push` | 3 min | Syncs the allow-list from `Asset` accounts, then `update_price` (+ mock_swap `set_price` off mainnet) |
| `performance` | 10 min | Hourly unit price series, returns, drawdown, contribution, holders → `bucket_metrics` |
| `leaderboard` | 1 h | One snapshot per period (7d/30d/90d/all); phase-2 eligibility computed, enforced behind a flag |
| `pool-monitor` | 5 min | Pool price (when a pool exists) vs unit price; alert when > 1% for over an hour |
| `routing-probe` | daily | Jupiter quote probe: smallest size and depth under 1% impact per token |
| `deadline-alerts` | daily | Alerts for buckets holding a token with an issuer deadline under 60 days away |
| `notifications` | 30 s | Sends queued edit notifications by email (Resend or log) and Telegram |

## Architecture

```
src/
  api/          Fastify app, routes (public, me, tx, cards), auth (Privy + dev), views (§3 shapes), quotes, geo
  chain/        ChainGateway interface + SdkChainGateway (@bucket/sdk), deployment file, keypairs
  indexer/      event types, decodeEvents (SDK), projection (event → derived tables), ingest/replay, RPC poller
  perf/         pure math: vault/commission (SDK math), cost basis, hourly series, returns/drawdown/contribution, eligibility
  catalog/      issuer fetchers, field mapping, merge/flagging, eligibility, issuer events, routing probe
  prices/       Jupiter price service, on-chain price pusher
  jobs/         the jobs above, registry, job_runs bookkeeping
  keeper/       keeper loop, settlement schedule, rebalance planner
  notify/       in-app notifications, email/Telegram channels, delivery dispatcher
  cards/        satori layouts (preview 1200×630, PnL 1080×1350), real QR, fonts, PNG cache
  fixtures/     design dataset and the program simulator used by seed:fixtures
migrations/     plain SQL, applied in order
config/         geo-restrictions.json, issuer-events.json (legal inputs; change config, not code)
scripts/        seed, rebuild, runJob, routing spike, localnet smoke test
assets/fonts/   Archivo 400–700 and JetBrains Mono 400–500 (OFL, licences alongside)
```

**Source of truth.** `events` (every program event with signature, slot, index) and `asset_prices` are the
primary inputs. Everything derived (buckets, versions, holdings, vault balances and their logs, supply log,
orders and legs, positions, commission settlements, hourly unit prices, metrics, leaderboard) is rebuilt by
`pnpm --filter @bucket/backend rebuild`, which truncates those tables, replays events in chain order and
reruns the jobs. A test asserts the rebuilt tables equal the live-projected ones.

**Chain access** goes only through `ChainGateway` (`src/chain/gateway.ts`). `SdkChainGateway` builds
fee-payer-signed v0 transactions with `BucketClient` (patterns from `vault/scripts/e2e.ts`): the publish
flow returns vault-ATA transactions, the lookup table (create + extends), `create_bucket` and the
creator's first `open_mint` in one batch; each bucket's lookup table address is stored in `bucket_chain`.
Transactions use the table only when they would not fit without it (a new table is accepted by the leader
about one root after creation). `/v1/tx/submit` relays a signed transaction, rebroadcasting every 2 s until
confirmed; it refuses programs outside the Bucket allow-list and transactions the signed-in wallet did not
sign (unless only the Bucket fee payer signs). Mints charge `rent_fee_e6` (≤ $1) when the fee payer creates
the backer's bucket-token account.

## Conventions in JSON

- USD totals: decimal strings, 2 dp (`"1064306.16"`). Per-token prices (`price`, `unitPrice`, `hwm`,
  `poolPrice`, `effectivePrice`): 6 dp. Percents: numbers rounded to 2 dp (`31.16`).
- Token amounts (`supply`, `tokens`, `tokensOut`, `balance`, redeem `tokens` input): **raw base-unit integer
  strings** (§1). Bucket tokens have 6 decimals; an asset `balance` uses its mint's decimals (see the catalog).
- `CatalogToken.price` / `Holding.price` / `markPrice` are per **UI** unit (what wallets and issuers show);
  valuations use the raw price (UI × Token-2022 scaled-UI multiplier in force). Use `valueUsd` rather than
  `balance × price`.
- `returns[period]` is `null` when the bucket is younger than the period; `maxDrawdown` is since creation.

**Additive fields** beyond §3: `CatalogToken.eligibilityReason` / `deadline`; `BucketDetail.fundingState`
(`awaiting_creator` until one creator mint order fills every leg, then `open`, or `closed`); quote routes
carry `reason` when unavailable and legs; `POST /v1/tx/create-bucket` also returns `order` (the creator's
first mint); `GET /v1/me` also returns `telegramChatId`. Additive endpoints: `POST /v1/tx/update-info`
(`{bucket, name, thesis}`) and `GET /v1/me/notifications` (in-app list).

## Auth

Writes need `Authorization: Bearer <token>`. `AUTH_MODE=privy`: the Privy access token is verified with
`@privy-io/server-auth`, and the user is mapped to a Solana wallet: the embedded Privy wallet first, else
the most recently verified external Solana wallet; a client may choose another of the user's own Solana
wallets with `X-Bucket-Wallet`. Linked accounts are cached in `users` for 10 minutes. `AUTH_MODE=dev`
also accepts `dev:<wallet>:<unix_ts>:<sig>`, where `sig` is the base58 (or base64) ed25519 signature of
`bucket-dev-auth:<wallet>:<unix_ts>`, valid for `DEV_AUTH_MAX_AGE_SECS` (`signDevToken` in `src/api/auth.ts`).
Writes are rate limited per client (`WRITE_RATE_LIMIT_PER_MIN`); CORS allows `WEB_ORIGIN`.

**Privy webhooks** (`POST /v1/webhooks/privy`). Token verification only tells us about a user while
they are using the app, so Privy pushes the rest: `user.created`, `user.authenticated`,
`user.linked_account`, `user.unlinked_account`, `user.updated_account`, `user.wallet_created`,
`user.transferred_account` sync the wallet, email and X handle (the verified badge), and
`user.deleted` clears every personal detail, keeping only the public wallet. Each delivery is
signature-verified with `PRIVY_WEBHOOK_SECRET` and recorded by its svix id, so Privy's retries apply
once; payloads are pruned after 30 days by the `privy-webhook-prune` job. A webhook never decides
which wallet a transaction is built for — that always comes from the verified access token on the
request. Set it up in the Privy dashboard (Webhooks → add endpoint) pointing at
`https://<api host>/v1/webhooks/privy`; locally, expose port 4000 with a tunnel
(`cloudflared tunnel --url http://localhost:4000`) since Privy cannot reach localhost.

**Geo-restrictions** (`config/geo-restrictions.json`, copied from `docs/legal/geo-restrictions.md`, checked
21 Sep 2026): `/v1/tx/*` returns **451** from a `blockAll` country or `blockRegionsAll` region, and from a
`blockPreIpo` country when the bucket holds (or the recipe adds) a pre-IPO token. `/v1/tx/redeem` is never
blocked; `/v1/tx/submit` relays a restricted user's transaction only if Bucket built and sponsored it or it
contains only exit instructions. The location comes from `CF-IPCountry` / `X-Vercel-IP-Country` (and region
headers); requests without them are not blocked, so production must run behind Cloudflare or Vercel.

## Methodology

- **Unit price** = Σ (vault balance − reserved) × price ÷ supply, hourly from event logs and the price
  series (`perf/series.ts`); points with zero supply or an unpriced held mint are skipped.
- **Returns**: unit price change over 7/30/90 days; "all" from the $100 launch price. **Max drawdown**:
  worst peak-to-trough fall since creation. **Contribution per holding** (30 days on the bucket page): each
  holding's value per token × its price return per hour; what else moved unit price that hour (commission
  dilution, swap and rebalance costs) is shared by value weight, so contributions sum to the return.
- **Holder view / cost basis** (`perf/costBasis.ts`), average cost: a mint fill adds its tokens at the USDC
  spent plus its share of the 0.20% fee and any rent fee; a refund's fee is a realized loss; redeems release
  basis at average cost and book proceeds (USDC, or in-kind value at claim time) as realized P&L; commission
  tokens a creator receives cost zero (their issue value is `commission_earned`); every holder's dilution
  at a settlement is `commission_paid`. Only program flows are seen: tokens moved by SPL transfer or bought
  in a pool are not.
- **Commission** math is `math` from `@bucket/sdk` (mirrors `math.rs`); tests reproduce the spec's worked
  example (125 → 120, supply 1,000 → 1,041.67 → 1,057.94).
- **Leaderboard eligibility** (phase 2, `LEADERBOARD_ENFORCE_ELIGIBILITY=true`): ≥ 14 days old and at least
  the period, creator's own tokens worth ≥ $25 at every hourly point in the window, every holding eligible
  in the catalog, bucket open. Phase 1 ranks every bucket and exposes `eligible`.
- **Catalog eligibility**: not flagged, priced, Jupiter liquidity ≥ `LIQUIDITY_FLOOR_USD` ($250k), no issuer
  event, and with `REQUIRE_QUOTE_PROBE` a route under 1% impact. Devnet mocks inherit from the mainnet
  token they mirror. See [`docs/spikes/catalog-and-routing.md`](../docs/spikes/catalog-and-routing.md).

## Fixtures

`seed:fixtures` loads the design's six buckets, creators and 20-token catalog as ~31k synthetic program
events (asset list, 186 days of prices, creations, mints and fills, daily settlements, redeems, edits
with rebalances, a pending edit) through the same ingest/projection code, then the jobs, link clicks and
pool prices. Real mainnet mints are used where the token exists (tSTRIPE and tDATABRICKS get synthetic
mints). Everything carries `fixture = true`; `seed:wipe` removes it and rebuilds. The keeper ignores
fixture buckets.

## Environment

See [`.env.example`](.env.example). Chain settings default from `vault/deployments/<CLUSTER>.json`, and
role keys from `../keys/` when present.

## Tests

`pnpm --filter @bucket/backend test` (uses database `bucket_test`, reset per suite): commission worked
example and vault math, cost basis, hourly series / returns / drawdown / contribution, eligibility and
recipe rules, catalog merge and flagging, field mapping and raw-price conversion, keeper planning and loop
(fake gateway), event projection and rebuild equivalence, auth (dev tokens, mocked Privy), card rendering,
issuer events and deadline alerts, geo-restrictions, and every API route shape via `fastify.inject`.
