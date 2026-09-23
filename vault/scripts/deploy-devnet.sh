#!/usr/bin/env bash
# Deploys both programs to devnet (deployer = upgrade authority), publishes the
# bucket_vault IDL on-chain, then initializes everything with setup.ts.
#
# Needs ~6 SOL on keys/deployer.json: bucket_vault rent ~4.62 SOL, setup ~1.2 SOL
# (mock_swap is already deployed on devnet; it is skipped when present).
#
# The public devnet RPC rate-limits program uploads hard (HTTP 429, "blockhash
# expired"). Use a dedicated devnet RPC if you have one:  RPC_URL=https://... ./deploy-devnet.sh
# Every step is resumable: rerun the script after a failure and it continues.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYS=../keys
URL=${RPC_URL:-https://api.devnet.solana.com}
DEPLOYER=$KEYS/deployer.json
BUF=$KEYS/bucket_vault-buffer.json
SOL="solana -u $URL --keypair $DEPLOYER"

anchor build

if ! $SOL program show AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx >/dev/null 2>&1; then
  $SOL program deploy --use-rpc --with-compute-unit-price 5000 --max-sign-attempts 50 \
    --upgrade-authority $DEPLOYER --program-id $KEYS/mock_swap.json target/deploy/mock_swap.so
fi

if ! $SOL program show GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29 >/dev/null 2>&1; then
  # 1. a buffer we keep the keypair of, so an interrupted upload resumes instead of restarting
  [ -f $BUF ] || solana-keygen new --no-bip39-passphrase --silent -o $BUF
  BUFFER=$(solana-keygen pubkey $BUF)
  if ! $SOL program show $BUFFER >/dev/null 2>&1; then
    $SOL program write-buffer target/deploy/bucket_vault.so --buffer $BUF --buffer-authority $DEPLOYER \
      --use-rpc --with-compute-unit-price 5000 --max-sign-attempts 50 || echo "write-buffer stopped early; finishing with the paced uploader"
  fi
  # 2. write whatever is still missing, a couple of transactions per second
  (cd scripts && RPC_URL=$URL pnpm exec tsx upload-buffer.ts --program ../target/deploy/bucket_vault.so --buffer ../$BUF)
  # 3. deploy from the finished buffer (one transaction)
  $SOL program deploy --buffer $BUFFER --program-id $KEYS/bucket_vault.json --upgrade-authority $DEPLOYER
fi

anchor idl init --provider.cluster "$URL" --provider.wallet $DEPLOYER \
  --filepath target/idl/bucket_vault.json GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29 \
  || anchor idl upgrade --provider.cluster "$URL" --provider.wallet $DEPLOYER \
  --filepath target/idl/bucket_vault.json GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29
cd scripts && RPC_URL="$URL" pnpm exec tsx setup.ts --cluster devnet
