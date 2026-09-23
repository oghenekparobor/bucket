# @bucket/web

The Bucket web app: leaderboard, share-link bucket page, builder, invest / sell-or-redeem, portfolio,
creator dashboard, account, creator profiles and the PnL card. Next.js 15 (App Router), React 19,
TypeScript strict, CSS Modules. Visual reference: `design/Bucket.dc.html`. API contract:
`docs/architecture.md` §3.

```bash
# from the repo root
pnpm install
pnpm --filter @bucket/web dev          # http://localhost:3000, auto mode (mock if the API is down)
pnpm --filter @bucket/web dev:mock     # force mock data
pnpm --filter @bucket/web build        # production build (type-checks and lints)
pnpm --filter @bucket/web typecheck
pnpm --filter @bucket/web lint
```

## Run modes

**API mode** (`NEXT_PUBLIC_API_MODE`)

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Production: live API. Development: calls `GET /v1/health` once (1.5 s timeout); if it does not answer, every call is served by the mock. |
| `live` | Always the backend at `NEXT_PUBLIC_API_URL` (server components use `API_URL` when set). |
| `mock` | Always fixtures. Build with it (`NEXT_PUBLIC_API_MODE=mock pnpm --filter @bucket/web build`) to run a production server on mock data. |

A yellow **MOCK DATA** badge sits next to the logo whenever the mock is active.

The mock (`src/lib/api/mock/`) returns the same shapes as the live API: the design's six ranked buckets, a
20-token catalog, two extra buckets for Kunle Adeyemi (one too new to rank, one closed and losing),
positions, stats and dashboard numbers. Writes are simulated in the browser and persisted in
`localStorage["bucket.mock.v1"]` (delete that key to reset):

- every `POST /v1/tx/*` returns a real v0 transaction (a memo instruction) already signed by a mock fee payer; the
  wallet signs it and `POST /v1/tx/submit` verifies every signature before applying the effect;
- mint and redeem orders fill one leg every ~650 ms through `GET /v1/orders/:address`;
- investing exactly **$13** on a bucket that routes through the vault simulates a leg that breaks the 1% slippage
  bound (order ends `refunded`, the Done screen explains the refund);
- investing exactly **$451** simulates a geo-restricted caller (HTTP 451): Invest and Publish are disabled for the tab
  with "Bucket isn't available in your region", Sell/Redeem keep working (clear `sessionStorage["bucket.geo451"]`);
- a bucket published in this browser reports `fundingState: 'awaiting_creator'` for 8 seconds, during which Invest is
  disabled with "Opens once the creator's stake has filled";
- the devnet faucet adds 1,000 USDC.

**Auth mode** (`NEXT_PUBLIC_AUTH_MODE`)

| Mode | When | What signs |
| --- | --- | --- |
| `privy` | `NEXT_PUBLIC_PRIVY_APP_ID` is set | Privy: email, Google, Apple, X, Phantom / Solflare / Backpack. Email and social users get an embedded Solana wallet on first login. Bearer = Privy access token. |
| `dev` | `NEXT_PUBLIC_AUTH_MODE=dev`, or no Privy app id | A local ed25519 keypair in `localStorage["bucket.devWallet.v1"]`. Bearer = `dev:<wallet>:<unix_ts>:<base58 sig of "bucket-dev-auth:<wallet>:<unix_ts>">` (fresh per request), matching the backend's `AUTH_MODE=dev`. |

Both sit behind one interface, `useAuth()` (`src/auth/types.ts`), plus `useSession().requireSignIn()`, which also
shows the Terms gate on first sign-in. Sign-in is only requested to create, invest, sell or make a PnL card (and for
the account-only pages). Browsing never needs it.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend base URL (browser, OG image URLs) |
| `API_URL` | – | Backend URL for server components, if different |
| `NEXT_PUBLIC_API_MODE` | `auto` | `auto` \| `live` \| `mock` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | – | Privy app. Empty means dev auth |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | – | Optional Privy client id |
| `NEXT_PUBLIC_AUTH_MODE` | derived | Force `dev` even with an app id |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` | `devnet` \| `mainnet-beta`: chain for Privy signing, explorer links, faucet visibility |
| `NEXT_PUBLIC_USDC_MINT` | – | Enables the Solana Pay "Open in wallet" deposit link on /account |
| `NEXT_PUBLIC_ENABLE_CARD_FUNDING` | `false` | Shows "Card or bank" (Privy `useFundWallet`) on /account; needs funding enabled in the Privy dashboard |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical/OG URLs and the href behind share links |
| `NEXT_PUBLIC_SHARE_HOST` | `bucket.xyz` | Short host printed on share links and PnL cards |

See `.env.example`.

## Transactions

Every transaction goes through `src/lib/txFlow.ts`:

1. `POST /v1/tx/*` returns base64 v0 transactions already signed by the Bucket fee payer.
2. The in-app confirmation sheet states the action and the USD amount. For invest and sell/redeem the modal itself is
   that sheet (the design's "Confirm · $250" / "Confirm exit · $X"; on phones the invest modal renders as the
   design's "Confirm investment" sheet). Publish, propose-edit, name/thesis update and close-bucket show
   `ConfirmSheet` after the transaction is built, listing how many signatures follow.
3. `checkUserSigner` refuses to sign anything where the user is not a required signer or would be the fee payer.
4. The wallet signs (`VersionedTransaction.deserialize` → Privy `useSignTransaction` with its own UI hidden, or the
   dev keypair), then `POST /v1/tx/submit`, in order.
5. Mints and redeems poll `GET /v1/orders/:address` every second (also in background tabs) and drive the Filling
   legs; `refunded` shows the unfilled-USDC message, and after 2 minutes the UI says the order may expire and refund.

Errors are mapped in `friendlyError`: insufficient USDC (with an "Add funds" link to `/account#add-funds`), slippage,
expired blockhash, user-cancelled signature, expired session.

## Structure

```
src/
  app/                      routes (App Router)
    page.tsx                / leaderboard (SSR + client period switch)
    b/[slug]/page.tsx       bucket page: SSR, generateMetadata with OG/Twitter image `${API}/og/b/<slug>.png`
    create/page.tsx         builder; ?edit=<slug> proposes a weights edit and updates name/thesis
    portfolio/ dashboard/ account/ creator/[wallet]/ legal/{terms,risks}/
    layout.tsx globals.css  fonts (Archivo, JetBrains Mono via next/font), providers, app shell
  styles/tokens.css         design tokens: every color, border, spacing and type value
  auth/                     useAuth (types, Dev + Privy providers), SessionProvider (terms gate, requireSignIn)
  components/
    shell/                  64px icon rail, 236px nav with Discover/You tabs, wallet card, page header, phone top bar + menu
    bucket/                 BucketView (share bar, pending banner, phone hero, header, chart, stats, holdings,
                            version history, proof panel, invest panel, creator controls, pre-IPO box)
    modals/                 InvestModal, RedeemModal, EditDiffModal, PnlModal, ConfirmSheet, OrderProgress
    create/                 CreateView (catalog, weights, stake, fixed terms, publish, edit mode, published modal)
    views/                  Leaderboard, Portfolio, Dashboard, Account, Creator, SignInGate
    ui/                     Modal (focus trap, Escape), primitives (Kpi, PeriodSwitch, badges, Toggle…), QrCode
  hooks/                    SWR hooks over the API, media query / clock hooks
  lib/
    api/                    types.ts (§3 shapes), client.ts (LiveApi + unit conversion), index.ts (mode), mock/
    txFlow.ts tx.ts         sign-and-submit pipeline, base64 <-> VersionedTransaction
    format.ts chart.ts      number/date formatting, SVG path builders
    constants.ts bucket.ts  fixed terms (20% commission, caps, limits), derived tags
```

Design notes: square corners, 1px ink borders and 10px tracked labels come from `tokens.css` and
`components/ui/ui.module.css`. Charts are hand-rolled SVG. The QR on the PnL card and the deposit address is a real
code from the `qrcode` package. "Save as image" renders the card DOM with `html-to-image` (falls back to a link to
the backend's `/og/pnl/...png`). On phones (≤640px) the bucket page, invest sheet and PnL card follow the design's
three phone mockups; below 900px the rail and nav collapse into a top bar with a Menu sheet.

## Contract notes (where the web had to choose)

- **Token amounts** are raw base units on the wire (bucket token: 6 decimals): `supply`, `tokensOut`, order and
  position `tokens`, and the `tokens` sent to `/v1/quote/redeem` and `/v1/tx/redeem`. `LiveApi` converts at the
  boundary; the rest of the app uses decimal strings.
- **Nullable fields** returned by the backend implementation: route `effectivePrice`/`effectiveVsUnitPct`/`costUsd`,
  quote `chosen` and `rentUsd`, `me.usdcBalance`/`solBalance` (RPC timeout), position `gainPct`. Shown as "—".
- **`/v1/me/dashboard`** follows `backend/src/api/routes/me.ts` (`buckets`, `backersByDay{day,newBackers}`,
  `commission{grossUsd,…}`, `funnel{linkClicks,uniqueVisitors,signedInFromLink,deposited}`). Leaderboard rank, the
  high-water mark and unpaid commission are derived from `/v1/leaderboard` and `/v1/buckets/:slug`. The design's
  yellow "shared on X" bars need an optional `shared` flag per day that the backend does not send yet.
- **`POST /v1/tx/update-info`** (name/thesis) exists in the backend but not in §3; the edit page uses it.
- **Mint fee copy**: the design says "No entry fee"; `Config.mint_fee_bps` is 20, so the invest modal shows the fee
  row and changes that sentence when `feeUsd > 0`.
- **Terms acceptance** is recorded in `localStorage["bucket.terms.v1"]` per wallet with a version, and through Privy's
  `useAcceptTerms` in Privy mode. There is no backend endpoint to record it.
- **Bucket tags** ("Pre-IPO heavy", "4 tokens", "Created …") are derived; the API has no tags field.
- **`fundingState`** (optional on bucket summaries/details): `'awaiting_creator'` disables Invest with "Opens once the
  creator's stake has filled". Not yet in architecture §3 or the backend.
- **HTTP 451** from any `/v1/tx/*` call marks the tab geo-restricted (`src/lib/geo.ts`): Invest and Publish are
  disabled with "Bucket isn't available in your region"; Sell/Redeem stay enabled.

## Legal copy

- `/legal/terms`, `/legal/risks`, `/legal/past-performance`, `/legal/creator-terms` render
  `docs/legal/{terms-of-service,risk-disclosures,past-performance-notice,creator-terms}.md` at build time
  (`src/lib/legal.ts`, `marked`). A DRAFT banner stays pinned at the top; `[[COUNSEL: …]]` placeholders are
  highlighted; blockquotes starting "Note" (notes to counsel, not meant to ship) are removed; links between drafts map
  to these routes. Set `BUCKET_LEGAL_DIR` if the docs live elsewhere at build time.
- The pre-IPO "not shares" paragraph is verbatim from `docs/legal/not-shares-notice.md`, in the variant matching the
  issuers the bucket holds (`components/bucket/NotShares.tsx`): on the invest confirmation (before Confirm, every route)
  and in the bucket page's pre-IPO box. The one-line variant appears in the builder when a pre-IPO token is picked.
- Commission copy says "paid in newly minted tokens: 80% to the creator, 20% to Bucket"; dollar examples are the total
  commission, split where shown.
- The invest confirmation always has a "Mint fee 0.20% · $X" row ("none on the pool route") and a "One-time account
  rent $X" row when the quote's `rentUsd` is non-zero.
- The bucket page notice keeps "The creator … can never withdraw, move or redirect your money" and links
  "Issuer and other risks" to `/legal/risks`. Past-performance variants from the notice are used on the leaderboard
  footer, creator profile, PnL card and buckets younger than 30 days.
