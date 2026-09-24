#!/usr/bin/env bash
# Deploys both programs to devnet (deployer = upgrade authority) — or upgrades bucket_vault when it
# is already there, extending its account first if the binary grew — publishes the bucket_vault IDL
# on-chain, then initializes everything with setup.ts (idempotent: a rerun finds it all in place).
#
# Needs ~6 SOL on keys/deployer.json: the program buffer ~5 SOL (returned once the deploy consumes
# it), an account extension ~0.4 SOL when the binary grew, setup ~1.2 SOL on a first run
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

PROGRAM=GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29
BIN=target/deploy/bucket_vault.so

# Writes the binary into a buffer we keep the keypair of (an interrupted upload resumes instead of
# restarting), first with the CLI, then the paced uploader finishes whatever the 429s left out.
write_buffer() {
  [ -f $BUF ] || solana-keygen new --no-bip39-passphrase --silent -o $BUF
  BUFFER=$(solana-keygen pubkey $BUF)
  if ! $SOL program show $BUFFER >/dev/null 2>&1; then
    $SOL program write-buffer $BIN --buffer $BUF --buffer-authority $DEPLOYER \
      --use-rpc --with-compute-unit-price 5000 --max-sign-attempts 50 || echo "write-buffer stopped early; finishing with the paced uploader"
  fi
  (cd scripts && RPC_URL=$URL pnpm exec tsx upload-buffer.ts --program ../$BIN --buffer ../$BUF)
}

if $SOL program show $PROGRAM >/dev/null 2>&1; then
  # ── upgrade ──
  # The program account is sized at its first deploy. A binary that outgrew it (Metaplex metadata
  # support took it from 908 KB to 979 KB) must extend the account first, or the upgrade fails
  # without naming the cause. Rent for the extension stays; the buffer's rent comes back.
  have=$($SOL program show $PROGRAM | awk '/Data Length/ {print $3}')
  need=$(wc -c < $BIN | tr -d ' ')
  if [ "$need" -gt "$have" ]; then
    echo "program account holds $have bytes, binary is $need: extending"
    $SOL program extend $PROGRAM $(( need - have + 4096 ))
  fi
  write_buffer
  $SOL program deploy --buffer $BUFFER --program-id $PROGRAM --upgrade-authority $DEPLOYER
else
  # ── first deploy ──
  write_buffer
  $SOL program deploy --buffer $BUFFER --program-id $KEYS/bucket_vault.json --upgrade-authority $DEPLOYER
fi

anchor idl init --provider.cluster "$URL" --provider.wallet $DEPLOYER \
  --filepath target/idl/bucket_vault.json GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29 \
  || anchor idl upgrade --provider.cluster "$URL" --provider.wallet $DEPLOYER \
  --filepath target/idl/bucket_vault.json GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29
cd scripts && RPC_URL="$URL" pnpm exec tsx setup.ts --cluster devnet
