# vault — Bucket's on-chain program, SDK and tooling

```
programs/bucket_vault   the Bucket program (Anchor 0.32): recipes, vaults, bucket token mints, commission
programs/mock_swap      devnet-only swap venue for mock stocks (never deploy to mainnet)
sdk/                    @bucket/sdk — PDAs, typed fetchers, instruction + flow builders, swap adapters, event decoder, math
tests/                  LiteSVM integration tests against the compiled program, through the SDK
scripts/                localnet/devnet setup, devnet deploy, Phase 1 end-to-end run, self-custody CLI, spikes
deployments/            addresses per cluster, written by scripts/setup.ts (read by the backend)
```

Contract: [`docs/architecture.md`](../docs/architecture.md) §2. Design decisions and trade-offs: [`docs/decisions.md`](../docs/decisions.md).

## Build and test

```bash
anchor build                                    # target/deploy/*.so, target/idl, target/types
cargo test -p bucket_vault --lib                # commission math incl. the spec's worked example
pnpm --filter @bucket/sdk build                 # syncs the IDL into sdk/src/idl, then compiles
pnpm --filter @bucket/vault-tests test          # 77 LiteSVM tests, ~4 s
```

| Test file | Covers |
| --- | --- |
| `loop.test.ts` | Phase 1 goal: create → second wallet invests → gain → redeem → creator commission → claim |
| `rules.test.ts` | Recipe rules (2–15 holdings, 2–50% / 25% pre-IPO, whole %, sum 100, allowed mints, 5 active buckets), $25/$1 minimums, 0.20% fee, close, pause, vault cap, name/thesis edits |
| `worked-example.test.ts` | The spec's commission table on-chain: $125 → $120 mark / 1,041.67 tokens, $108, $130 → $128 / 1,057.94 |
| `invariant.test.ts` | 60 random mints/redeems/price moves/settlements: supply × unit price = vault value, no dilution, supply fully accounted |
| `security.test.ts` | Instruction tripwire, and every creator/keeper path that could move vault assets, attacked and rejected |
| `failures.test.ts` | Slippage breach, failed swap, zero liquidity, mint+redeem same slot, dust, issuer transfer fees, expiry, stale prices (exit still works), strangers |
| `edits.test.ts` | propose/activate edits (24h, 7-day cooldown, creator pays new vaults), rebalance direction and bounds, pruning, forced removal; price clamp, TWAP, spike vs sustained rise |
| `scale.test.ts` | 15-holding spike: transactions and compute per mint/redeem → `docs/spikes/fifteen-holding-mint.*` |

## Run it locally (real validator)

```bash
cd scripts
bash localnet.sh                  # in its own terminal: validator with both programs, deployer as upgrade authority
pnpm exec tsx setup.ts            # mock USDC, venue, Config, 31 mock stocks → ../deployments/localnet.json
pnpm exec tsx e2e.ts              # the Phase 1 goal with two wallets, printed step by step
```

## Deploy to devnet

**Deployed on devnet (22 Sep 2026):** `bucket_vault` `GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29`, `mock_swap` `AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx`, IDL on-chain, 31 mock tokens + mock USDC (`deployments/devnet.json`). Upgrade authority: `keys/deployer.json`.

A fresh deploy needs ~6 SOL on `keys/deployer.json` (`bucket_vault` rent ~4.62 SOL, setup ~1.2 SOL). The script skips programs that already exist, so **upgrades** go through a buffer. That needs ~4.62 SOL while the buffer exists, which is refunded when the upgrade lands:

```bash
anchor build
solana program write-buffer target/deploy/bucket_vault.so --buffer ../keys/bucket_vault-buffer.json \
  --buffer-authority ../keys/deployer.json --keypair ../keys/deployer.json -u devnet --use-rpc || true
(cd scripts && pnpm exec tsx upload-buffer.ts --program ../target/deploy/bucket_vault.so --buffer ../../keys/bucket_vault-buffer.json)
solana program upgrade $(solana-keygen pubkey ../keys/bucket_vault-buffer.json) GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29 \
  --upgrade-authority ../keys/deployer.json --keypair ../keys/deployer.json -u devnet
```

```bash
cd scripts && bash deploy-devnet.sh                          # public RPC (slow: it rate-limits uploads)
RPC_URL=https://<your devnet rpc> bash deploy-devnet.sh      # recommended
pnpm exec tsx e2e.ts --cluster devnet
```

The script is resumable. It uploads `bucket_vault` into a buffer whose keypair is kept at `keys/bucket_vault-buffer.json`, finishes any missing chunks with `upload-buffer.ts` (a paced uploader that skips chunks already written), then deploys from the buffer in one transaction. Rerun it after any failure.

## Exit with nothing but your key

`scripts/cli.ts` needs an exported wallet key and an RPC URL. It runs with no Bucket API, keeper or web app:

```bash
pnpm exec tsx cli.ts redeem --bucket <address> --tokens all --keypair ~/exported.json
pnpm exec tsx cli.ts sell   --order <redeem order> --keypair ~/exported.json      # sell your slice yourself
pnpm exec tsx cli.ts claim  --order <redeem order> --keypair ~/exported.json      # or take the stocks in kind
```

## Program at a glance

| Instruction | Signer | Effect |
| --- | --- | --- |
| `create_bucket` | creator | Validates the recipe, creates the bucket token mint and fee accounts. Vault ATAs are created beforehand by the client |
| `open_mint` → `fill_mint`* → `close_mint_order` | backer, then keeper or backer | Settle commission, fee, escrow, one fill per leg (tokens issued per leg), refund the rest |
| `redeem` → `fill_redeem`* / `claim_redeem_in_kind`* → `close_redeem_order` | holder, then keeper or holder | Settle (if prices fresh), burn, reserve slice, sell or take in kind |
| `settle_commission`, `claim_fees` | anyone / creator | 20% of growth above the mark, as new tokens split 80/20 creator/platform |
| `propose_edit`, `activate_edit`, `rebalance`, `admin_propose_removal` | creator / anyone / keeper / admin | Phase 2 edits with 24h notice and keeper rebalancing |
| `update_bucket_info`, `close_bucket` | creator | Name and thesis; stop new money (redeem stays open) |
| `initialize_config`, `update_config`, `set_roles`, `add_asset`, `set_asset_status`, `update_price`, `force_price` | upgrade authority / admin / price authority | Config and catalog |
