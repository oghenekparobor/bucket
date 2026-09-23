# Bucket

Bundle tokenized stocks into a named, weighted basket that is also a fully backed token. Anyone with the link can invest from $1 and leave at any time. Creators earn 20% of gains above the bucket's previous high. Solana, non-custodial, priced in USD.

| Product | Folder | What it is |
| --- | --- | --- |
| **Vault** | [`vault/`](vault/) | Anchor program `bucket_vault` (recipes, vaults, bucket token mints, commission), the devnet venue `mock_swap`, the TypeScript SDK `@bucket/sdk`, LiteSVM tests, deploy/setup scripts and a self-custody CLI |
| **Backend** | [`backend/`](backend/) | API (Privy auth, sponsored transactions), catalog + price service, indexer, performance and leaderboard jobs, keeper, notifications, preview and PnL card renderer |
| **Web** | [`web/`](web/) | Next.js app built from the Claude Design project: leaderboard, bucket page, builder, invest/redeem, portfolio, creator dashboard, PnL card |
| **Design** | [`design/`](design/) | `Bucket.dc.html`, imported from Claude Design — the visual reference |
| **Docs** | [`docs/`](docs/) | [Spec](docs/product-v2.md) · [Checklist](docs/execution-checklist.md) · [Architecture & contracts](docs/architecture.md) · [Decisions](docs/decisions.md) · [Spikes](docs/spikes/) · [Ops](docs/ops/) · [Legal drafts](docs/legal/) · [Security](docs/security/) · [Design notes](docs/design/) · [P0 tracker](docs/p0-tracker.md) |

## Quick start (everything local)

Requires Node 22, pnpm 11, Rust 1.89, Solana CLI 3.1, Anchor 0.32, and a local Postgres.

```bash
pnpm install
cd vault && anchor build && cd ..
pnpm --filter @bucket/sdk build
pnpm --filter @bucket/vault-tests test            # program tests (LiteSVM)

# a local chain with everything deployed and listed
(cd vault/scripts && bash localnet.sh)             # leave running
(cd vault/scripts && pnpm exec tsx setup.ts)      # writes vault/deployments/localnet.json
(cd vault/scripts && pnpm exec tsx e2e.ts)        # the Phase 1 goal, end to end

pnpm dev:backend                                  # see backend/README.md for env and jobs
pnpm dev:web                                      # see web/README.md; works in mock mode without the backend
```

## Keys

Devnet role keys live in `keys/` (gitignored). See [`docs/ops/keys.md`](docs/ops/keys.md) for who holds what and what each key can and cannot do.
