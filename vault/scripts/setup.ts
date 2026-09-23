// Brings a cluster (localnet or devnet) to a usable state, idempotently:
// mock USDC, mock_swap venue, bucket_vault Config, one mock Token-2022 mint +
// market + catalog Asset per token in catalog.json, fee wallet USDC account,
// and SOL for the keeper / price authority / fee payer.
// Writes every address to ../deployments/<cluster>.json — the backend reads it.
//
//   pnpm setup                   # localnet (run ./localnet.sh first)
//   pnpm setup:devnet            # devnet (after deploy-devnet.sh deploys the programs)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import BN from 'bn.js';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
  BucketClient,
  BUCKET_VAULT_PROGRAM_ID,
  defaultConfigParams,
  MOCK_SWAP_PROGRAM_ID,
  MockSwapAdapter,
  type AssetKind,
  type Source,
} from '@bucket/sdk';

const here = dirname(fileURLToPath(import.meta.url));
const KEYS = join(here, '..', '..', 'keys');

export interface CatalogToken {
  symbol: string;
  name: string;
  source: Source;
  kind: AssetKind;
  mainnetMint: string;
  decimals: number;
  transferFeeBps: number;
  price: number;
  markPrice: number | null;
}

export interface Deployment {
  cluster: string;
  rpcUrl: string;
  programs: { bucketVault: string; mockSwap: string };
  usdcMint: string;
  roles: { admin: string; keeper: string; priceAuthority: string; feeWallet: string; feePayer: string };
  tokens: (CatalogToken & { mint: string; tokenProgram: string })[];
  updatedAt: string;
}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const loadKey = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS, `${name}.json`), 'utf8'))));

async function main() {
  const cluster = arg('cluster', 'localnet');
  const rpcUrl = process.env.RPC_URL ?? (cluster === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');
  const connection = new Connection(rpcUrl, 'confirmed');
  const outPath = join(here, '..', 'deployments', `${cluster}.json`);
  const prior: Partial<Deployment> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};

  const deployer = loadKey('deployer');
  const keeper = loadKey('keeper');
  const priceAuthority = loadKey('price-authority');
  const feeWallet = loadKey('platform-fees');
  const feePayer = loadKey('fee-payer');

  for (const id of [BUCKET_VAULT_PROGRAM_ID, MOCK_SWAP_PROGRAM_ID]) {
    const ai = await connection.getAccountInfo(id);
    if (!ai?.executable) throw new Error(`program ${id.toBase58()} is not deployed on ${cluster}; run ./localnet.sh or ./deploy-devnet.sh first`);
  }

  // Public RPCs are load-balanced and flaky: retry the errors that mean "nothing landed, try again".
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = []) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
        return await sendAndConfirmTransaction(connection, tx, [deployer, ...signers], { commitment: 'confirmed' });
      } catch (e) {
        const msg = String(e);
        if (attempt >= 6 || !/Blockhash not found|block height exceeded|fetch failed|429|Too many|ECONNRESET|socket hang up/i.test(msg)) throw e;
        console.log(`transient error, retry ${attempt}: ${msg.slice(0, 90)}`);
        await new Promise((r) => setTimeout(r, 3_000 * attempt));
      }
    }
  };

  // SOL for the service wallets
  for (const k of [keeper, priceAuthority, feePayer, feeWallet]) {
    const bal = await connection.getBalance(k.publicKey);
    const want = cluster === 'localnet' ? 100 * LAMPORTS_PER_SOL : 0.2 * LAMPORTS_PER_SOL;
    if (bal < want / 2) await send([SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: k.publicKey, lamports: want - bal })]);
  }

  const client = new BucketClient(connection);
  const mockPdas = new MockSwapAdapter(connection, PublicKey.default).pdas;
  const authority = mockPdas.mintAuthority();

  const createMint = async (decimals: number, tokenProgram: PublicKey, transferFeeBps = 0) => {
    const mint = Keypair.generate();
    const len = transferFeeBps > 0 ? getMintLen([ExtensionType.TransferFeeConfig]) : MINT_SIZE;
    const ixs = [
      SystemProgram.createAccount({
        fromPubkey: deployer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: len,
        lamports: await connection.getMinimumBalanceForRentExemption(len),
        programId: tokenProgram,
      }),
    ];
    if (transferFeeBps > 0) {
      ixs.push(createInitializeTransferFeeConfigInstruction(mint.publicKey, deployer.publicKey, deployer.publicKey, transferFeeBps, BigInt('18446744073709551615'), tokenProgram));
    }
    ixs.push(createInitializeMint2Instruction(mint.publicKey, decimals, authority, null, tokenProgram));
    try {
      await send(ixs, [mint]);
    } catch (e) {
      // a send that timed out may still have landed
      if (!(await connection.getAccountInfo(mint.publicKey))) throw e;
    }
    return mint.publicKey;
  };

  // mock USDC: whatever the on-chain config already uses wins, so a rerun never forks the setup
  const configExists = !!(await connection.getAccountInfo(client.pdas.config()));
  let usdcMint = configExists ? (await client.config()).usdcMint : prior.usdcMint ? new PublicKey(prior.usdcMint) : null;
  if (!usdcMint || !(await connection.getAccountInfo(usdcMint))) {
    usdcMint = await createMint(6, TOKEN_PROGRAM_ID);
    console.log('mock USDC', usdcMint.toBase58());
  }
  const swap = new MockSwapAdapter(connection, usdcMint);

  if (!(await connection.getAccountInfo(mockPdas.state()))) {
    await send([
      await swap.program.methods
        .initState(priceAuthority.publicKey)
        .accountsPartial({ admin: deployer.publicKey, state: mockPdas.state(), mintAuthority: authority, usdcMint, systemProgram: SystemProgram.programId })
        .instruction(),
    ]);
    console.log('mock_swap state initialized');
  }

  if (!(await connection.getAccountInfo(client.pdas.config()))) {
    await send([
      await client.initializeConfigIx({
        authority: deployer.publicKey,
        usdcMint,
        params: defaultConfigParams(),
        roles: {
          admin: deployer.publicKey,
          keeper: keeper.publicKey,
          priceAuthority: priceAuthority.publicKey,
          feeWallet: feeWallet.publicKey,
          swapPrograms: [MOCK_SWAP_PROGRAM_ID, PublicKey.default, PublicKey.default, PublicKey.default],
        },
      }),
      createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, getAssociatedTokenAddressSync(usdcMint, feeWallet.publicKey), feeWallet.publicKey, usdcMint),
    ]);
    console.log('bucket_vault config initialized');
  }

  // catalog: one mock per real token
  const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8')).tokens as CatalogToken[];
  const known = new Map((prior.tokens ?? []).map((t) => [t.mainnetMint, t.mint]));
  // tokens already listed on-chain (e.g. by an interrupted run) are found by symbol and reused
  const listed = new Map<string, string>();
  try {
    for (const a of await client.allAssets()) listed.set(a.account.symbol, a.account.mint.toBase58());
  } catch {
    // getProgramAccounts not available on this RPC: rely on the deployment file
  }
  const tokens: Deployment['tokens'] = [];
  const save = () => {
    const deployment: Deployment = {
      cluster,
      rpcUrl,
      programs: { bucketVault: BUCKET_VAULT_PROGRAM_ID.toBase58(), mockSwap: MOCK_SWAP_PROGRAM_ID.toBase58() },
      usdcMint: usdcMint!.toBase58(),
      roles: {
        admin: deployer.publicKey.toBase58(),
        keeper: keeper.publicKey.toBase58(),
        priceAuthority: priceAuthority.publicKey.toBase58(),
        feeWallet: feeWallet.publicKey.toBase58(),
        feePayer: feePayer.publicKey.toBase58(),
      },
      tokens,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(outPath, JSON.stringify(deployment, null, 2) + '\n');
  };
  for (const t of catalog) {
    const existing = known.get(t.mainnetMint) ?? listed.get(t.symbol.slice(0, 16));
    let mint = existing ? new PublicKey(existing) : null;
    if (!mint || !(await connection.getAccountInfo(mint))) mint = await createMint(t.decimals, TOKEN_2022_PROGRAM_ID, t.transferFeeBps);
    const priceE6 = BigInt(Math.round(t.price * 1e6));
    const ixs: TransactionInstruction[] = [];
    if (!(await connection.getAccountInfo(mockPdas.market(mint)))) {
      ixs.push(
        await swap.program.methods
          .createMarket(new BN(priceE6.toString()), 10)
          .accountsPartial({ admin: deployer.publicKey, state: mockPdas.state(), mintAuthority: authority, stockMint: mint, market: mockPdas.market(mint), systemProgram: SystemProgram.programId })
          .instruction(),
        createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, mockPdas.inventory(mint, TOKEN_2022_PROGRAM_ID), authority, mint, TOKEN_2022_PROGRAM_ID),
      );
    }
    if (!(await connection.getAccountInfo(client.pdas.asset(mint)))) {
      ixs.push(
        await client.addAssetIx({
          admin: deployer.publicKey,
          mint,
          source: t.source,
          kind: t.kind,
          symbol: t.symbol.slice(0, 16),
          extraCostBps: t.transferFeeBps,
          priceE6,
        }),
      );
    }
    if (ixs.length) {
      await send(ixs);
      console.log(`listed ${t.symbol} → ${mint.toBase58()}`);
    }
    tokens.push({ ...t, mint: mint.toBase58(), tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58() });
    save(); // after every token, so an interrupted run resumes without orphans
  }
  save();
  console.log(`wrote ${outPath}: ${tokens.length} tokens`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
