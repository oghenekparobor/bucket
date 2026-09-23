# Spike: proportional mint into a 15-holding vault

Checklist 0.3: *Prototype a proportional mint into a 15-holding vault. Measure how many transactions it takes and what a failed leg looks like.*

Reproduce: `pnpm --filter @bucket/vault-tests test -- scale` (writes `fifteen-holding-mint.json` next to this file). Measured in LiteSVM running the release build of `bucket_vault`, against the devnet mock venue. Twelve xStocks-style holdings, two PreStocks-style holdings with a 1% transfer fee, and one Tessera-style holding at 0.2%.

## Results

| Step | Transactions | Compute units |
| --- | --- | --- |
| Publish: 15 vault ATAs | 3 (5 per tx) | – |
| Publish: `create_bucket` | 1 | – |
| Publish: lookup table (59 addresses) | 3 (create + 2 extends) | – |
| **Mint: `open_mint`** (settle + escrow + 15 leg budgets) | **1** | ~142k |
| **Mint: `fill_mint`** | **2** (8 + 7 legs per tx) | ~512k and ~461k |
| Mint: `close_mint_order` (refund dust, close accounts) | 1 | small |
| One fill leg on its own | – | ~57k |
| **Redeem: `redeem`** (settle + burn + reserve 15 slices) | **1** | ~84k |
| Redeem: `fill_redeem` | 15 (one per leg as measured; they pack like fills) | ~56k each |

**A 15-holding mint is 4 transactions and one user signature.** The user signs only `open_mint`; the keeper sends the fills and the close.

## What a failed leg looks like

The venue quoted a holding 5% away from the on-chain price. The leg's `fill_mint` failed with `SlippageExceeded` and the whole transaction reverted. Nothing moved: the escrow kept that leg's USDC and no tokens were issued for it. The other legs filled normally and paid tokens as each completed. When the keeper (or the backer) calls `close_mint_order`, the unfilled USDC goes straight back to the backer. Tested in `failures.test.ts`: slippage breach, venue rejecting min-out, zero liquidity within bounds, expiry.

## Caveats for mainnet

- Jupiter routes carry many more accounts than the mock venue, so expect **1–3 legs per fill transaction**, not 8. That puts a 15-holding mint at roughly 6–16 keeper transactions. Still one user signature.
- The per-bucket lookup table is required once a bucket has more than about 6 holdings. The backend creates it at publish, with the fee payer as authority.
- Compute is not the constraint: a single leg costs ~57k CU against a 1.4M limit.
