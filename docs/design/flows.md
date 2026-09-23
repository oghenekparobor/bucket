# End-to-end flows

Checklist 1.4: *End-to-end flows for creator, backer and visitor on mobile and desktop.*

Source of truth for the visuals: [`design/Bucket.dc.html`](../../design/Bucket.dc.html), imported from the Claude Design project "Pending product design spec". The web app implements it (`web/`). Each step below names the screen and the system action behind it.

## Visitor → backer (the share link path; target: under 2 minutes)

| Step | Desktop | Mobile | System |
| --- | --- | --- | --- |
| 1. Opens `bucket.xyz/b/<slug>` from X, WhatsApp, Telegram | Bucket page (no sign-in) | Phone screen 1 "Shared by …" | Server-rendered page; OG preview card `/og/b/<slug>.png` |
| 2. Reads return, drawdown, holdings, pre-IPO notice, commission | Bucket page panels | Screen 1 (return, chart, holdings) | `GET /v1/buckets/:slug`, `/chart` |
| 3. Taps Invest | Invest modal | Invest button | Sign-in requested here and only here |
| 4. Signs in (email, Google, Apple, X, or wallet) | Privy modal | Privy sheet | Embedded wallet created on first sign-in; ToS acceptance recorded |
| 5. Adds funds if needed | Account → Add funds | Account screen | Deposit address + QR, external transfer, card/bank via Privy funding, devnet faucet |
| 6. Enters an amount and sees both routes | Invest modal: routes, summary, "How the 20% works" | Screen 2 confirmation sheet | `GET /v1/quote/mint` (mint route vs pool route) |
| 7. Confirms once | Confirm | Confirm | `POST /v1/tx/mint` → wallet signs → `/v1/tx/submit`; fees sponsored |
| 8. Watches it fill | Filling legs + progress | same | Keeper fills legs; `GET /v1/orders/:address` |
| 9. Done → PnL card | Done → Make a PnL card | Screen 3 PnL card | `/og/pnl/<slug>.png`, share to X/WhatsApp/Telegram, save image |

## Creator (target: idea to funded, shareable bucket in under 3 minutes)

| Step | Screen | System |
| --- | --- | --- |
| 1. New bucket | Create: name, thesis (280) | – |
| 2. Search and add 2–15 tokens | Catalog search with live price, source badge, pre-IPO label | `GET /v1/catalog` |
| 3. Set weights | Sliders with caps (50% / 25% pre-IPO), equal weight, total bar and hint | Same rules enforced on-chain |
| 4. Stake at least $25 | "Your stake" | Creator's first mint, on-chain minimum |
| 5. Publish | Publish button → Published modal with share link | `POST /v1/tx/create-bucket`: vault accounts, `create_bucket`, lookup table, first `open_mint`, all in one signature |
| 6. Share | Copy link / PnL card | Share link and preview card |
| 7. Later: edit | Pending-edit banner, diff modal, version history | `propose_edit` (24h notice, 1 per 7 days); backers notified |
| 8. Earn | Creator dashboard: commission, backers by day, link funnel | `settle_commission`; `claim_fees` |

## Backer exit

| Step | Screen | System |
| --- | --- | --- |
| 1. Sell or redeem | Portfolio → Sell, or bucket page → Sell or redeem | `GET /v1/quote/redeem` |
| 2. Choose percent, see proceeds and effective price | Redeem modal | – |
| 3. Confirm | – | `redeem` burns and reserves; keeper sells legs to USDC |
| If Bucket is down | – | `vault/scripts/cli.ts` with the exported key: sell legs or take the stocks in kind |
