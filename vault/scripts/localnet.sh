#!/usr/bin/env bash
# Local validator with both programs deployed as *upgradeable*, deployer as
# upgrade authority (initialize_config checks it). Then run `pnpm setup`.
set -euo pipefail
cd "$(dirname "$0")/.."
DEPLOYER=$(solana-keygen pubkey ../keys/deployer.json)
exec solana-test-validator --reset --quiet --ledger test-ledger \
  --mint "$DEPLOYER" \
  --upgradeable-program GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29 target/deploy/bucket_vault.so "$DEPLOYER" \
  --upgradeable-program AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx target/deploy/mock_swap.so "$DEPLOYER"
