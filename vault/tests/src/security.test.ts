// Neither the creator nor the keeper has any instruction path that moves
// assets out of a vault. Every instruction that can move vault tokens is
// attacked here from both roles; each attack must fail.

import { beforeAll, describe, expect, it } from 'vitest';
import BN from 'bn.js';
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

import { BUCKET_VAULT_IDL, MOCK_SWAP_PROGRAM_ID, defaultConfigParams } from '@bucket/sdk';
import { Chain, DESIGN_STOCKS, usd } from './harness.js';
import { invest, openMint, publish, redeem, type Published } from './flows.js';

/**
 * Every instruction and who may sign it. Adding an instruction breaks this
 * test on purpose: review its vault outflows, then add it here.
 */
const INSTRUCTION_SIGNERS: Record<string, string> = {
  initializeConfig: 'upgrade authority',
  updateConfig: 'admin',
  setRoles: 'admin',
  addAsset: 'admin',
  setAssetStatus: 'admin',
  updatePrice: 'price authority',
  forcePrice: 'admin',
  createBucket: 'creator',
  closeBucket: 'creator',
  updateBucketInfo: 'creator — name and thesis only',
  settleCommission: 'anyone — mints fee tokens, moves no vault assets',
  claimFees: 'creator (own fee account) / anyone (platform fee account to fee wallet)',
  openMint: 'backer — moves only the backer’s own USDC',
  fillMint: 'keeper or backer — spends only the order escrow; output must land in the vault',
  closeMintOrder: 'backer / keeper / anyone after expiry — refunds escrow to the backer only',
  redeem: 'holder — burns own tokens, reserves own slice',
  fillRedeem: 'keeper or holder — sells only the holder’s reserved slice, USDC only to the holder',
  claimRedeemInKind: 'holder — reserved slice to the holder only',
  closeRedeemOrder: 'anyone once done — closes an empty order',
  proposeEdit: 'creator — changes target weights only, 24h notice',
  adminProposeRemoval: 'admin — changes target weights only, 24h notice',
  activateEdit: 'anyone after notice — changes target weights only',
  rebalance: 'keeper — vault to vault only, toward target, within slippage',
};

describe('no instruction path moves vault assets out', () => {
  let chain: Chain;
  let creator: Keypair;
  let backer: Keypair;
  let b: Published;
  const keeper = () => chain.keeper;

  beforeAll(async () => {
    chain = await Chain.boot(DESIGN_STOCKS);
    creator = chain.user();
    backer = chain.user();
    await chain.faucet(creator.publicKey, usd(2_000));
    await chain.faucet(backer.publicKey, usd(2_000));
    b = await publish(chain, creator, { name: 'Target', holdings: [['NVDAx', 40], ['AAPLx', 35], ['pSPACEX', 25]] });
    await invest(chain, creator, b, usd(1_000));
    await invest(chain, backer, b, usd(1_000));
  });

  it('instruction list is exactly the reviewed set', () => {
    const names = BUCKET_VAULT_IDL.instructions.map((i) => i.name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())).sort();
    expect(names).toEqual(Object.keys(INSTRUCTION_SIGNERS).sort());
  });

  /** Token accounts of `owner` for each stock, created if needed. */
  const stockAccounts = async (owner: PublicKey) => {
    const out = new Map<string, PublicKey>();
    const ixs: TransactionInstruction[] = [];
    for (const [sym, s] of chain.stocks) {
      const ata = getAssociatedTokenAddressSync(s.mint, owner, true, s.tokenProgram);
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(chain.admin.publicKey, ata, owner, s.mint, s.tokenProgram));
      out.set(sym, ata);
    }
    await chain.send(ixs, [chain.admin]);
    return out;
  };

  it('keeper cannot divert a mint leg to itself', async () => {
    const order = await openMint(chain, backer, b, usd(100));
    const o = await chain.client.mintOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const mine = await stockAccounts(keeper().publicKey);
    const leg = o.legs[0]!;
    const route = await chain.swap.build({
      inputMint: config.usdcMint,
      outputMint: leg.mint,
      amountIn: BigInt(leg.budgetE6.toString()),
      authority: order,
      source: chain.client.pdas.escrow(order, config.usdcMint),
      destination: mine.get('NVDAx')!, // not the vault
      slippageBps: 100,
    });
    const ix = await chain.client.program.methods
      .fillMint(0, leg.budgetE6, new BN(0), route.data)
      .accountsPartial({
        signer: keeper().publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        bucketMint: bucket.tokenMint,
        order,
        escrow: chain.client.pdas.escrow(order, config.usdcMint),
        vault: bucket.holdings[0]!.vault,
        asset: chain.client.pdas.asset(leg.mint),
        backerBucketAta: getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey),
        swapProgram: MOCK_SWAP_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(route.keys)
      .instruction();
    expect(await chain.expectError([ix], [keeper()], [b.table])).toBe('OutputTooLow');
    // the backer gets every cent back
    const before = chain.usdcOf(backer.publicKey);
    await chain.send([await chain.client.closeMintOrderIx({ signer: keeper().publicKey, config, orderAddress: order, order: o })], [keeper()]);
    expect(chain.usdcOf(backer.publicKey) - before).toBe(BigInt(o.usdcTotalE6.toString()));
  });

  it('keeper cannot use a swap program that is not allow-listed (e.g. a raw token transfer)', async () => {
    const order = await redeem(chain, backer, b, 100_000n);
    const o = await chain.client.redeemOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const h = bucket.holdings[0]!;
    const s = chain.stock('NVDAx');
    const mine = (await stockAccounts(keeper().publicKey)).get('NVDAx')!;
    const transfer = createTransferCheckedInstruction(h.vault, s.mint, mine, b.address, 1n, 8, [], TOKEN_2022_PROGRAM_ID);
    const ix = await chain.client.program.methods
      .fillRedeem(0, new BN(1), new BN(0), transfer.data)
      .accountsPartial({
        signer: keeper().publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        bucketMint: bucket.tokenMint,
        order,
        vault: h.vault,
        asset: chain.client.pdas.asset(s.mint),
        holderUsdc: getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey),
        swapProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(transfer.keys.map((k) => ({ ...k, isSigner: false })))
      .instruction();
    expect(await chain.expectError([ix], [keeper()], [b.table])).toBe('SwapProgramNotAllowed');
    expect(o.legs.length).toBe(3);
  });

  it('keeper cannot send redeem proceeds to itself', async () => {
    const order = await redeem(chain, backer, b, 100_000n);
    const o = await chain.client.redeemOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillRedeemIx({ signer: keeper().publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    // point holder_usdc at the keeper's USDC account
    const keeperUsdc = await chain.faucet(keeper().publicKey, usd(1));
    const ix = f.ixs[0]!;
    const idx = ix.keys.findIndex((k) => k.pubkey.equals(getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey)));
    ix.keys[idx] = { ...ix.keys[idx]!, pubkey: keeperUsdc };
    expect(await chain.expectError([ix], [keeper()], [b.table])).toMatch(/ConstraintTokenOwner|OutputTooLow/);

    // and cannot route the swap's USDC output to itself while naming the holder
    const route = await chain.swap.build({
      inputMint: o.legs[0]!.mint,
      outputMint: config.usdcMint,
      amountIn: BigInt(o.legs[0]!.qty.toString()),
      authority: b.address,
      source: bucket.holdings[0]!.vault,
      destination: keeperUsdc,
      slippageBps: 100,
    });
    const ix2 = await chain.client.program.methods
      .fillRedeem(0, o.legs[0]!.qty, new BN(0), route.data)
      .accountsPartial({
        signer: keeper().publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        bucketMint: bucket.tokenMint,
        order,
        vault: bucket.holdings[0]!.vault,
        asset: chain.client.pdas.asset(o.legs[0]!.mint),
        holderUsdc: getAssociatedTokenAddressSync(config.usdcMint, backer.publicKey),
        swapProgram: MOCK_SWAP_PROGRAM_ID,
      })
      .remainingAccounts(route.keys)
      .instruction();
    // holder's USDC does not move, so the output or slippage check rejects it
    expect(await chain.expectError([ix2], [keeper()], [b.table])).toMatch(/OutputTooLow|SlippageExceeded/);
  });

  it('a redeem swap cannot touch any other vault account, the bucket mint, or fee accounts', async () => {
    const order = await redeem(chain, backer, b, 100_000n);
    const o = await chain.client.redeemOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillRedeemIx({ signer: keeper().publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    for (const extra of [bucket.holdings[1]!.vault, bucket.tokenMint, chain.client.pdas.creatorFee(b.address), chain.client.pdas.platformFee(b.address)]) {
      const ix = new TransactionInstruction({ ...f.ixs[0]!, keys: [...f.ixs[0]!.keys, { pubkey: extra, isSigner: false, isWritable: true }] });
      expect(await chain.expectError([ix], [keeper()], [b.table])).toBe('ForbiddenSwapAccount');
    }
  });

  it('creator cannot fill, claim, or sell anyone else’s redeem', async () => {
    const order = await redeem(chain, backer, b, 100_000n);
    const o = await chain.client.redeemOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillRedeemIx({ signer: creator.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    expect(await chain.expectError(f.ixs, [creator], [b.table])).toBe('Unauthorized');

    const claim = await chain.client.claimInKindIxs({ holder: creator.publicKey, payer: creator.publicKey, bucketAddress: b.address, bucket, orderAddress: order, order: o, leg: 0 });
    expect(await chain.expectError(claim, [creator], [b.table])).toMatch(/ConstraintHasOne|ConstraintTokenOwner/);
  });

  it('creator cannot fill a backer’s mint order', async () => {
    const order = await openMint(chain, backer, b, usd(50));
    const o = await chain.client.mintOrder(order);
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const f = await chain.client.fillMintIx({ signer: creator.publicKey, bucketAddress: b.address, bucket, config, orderAddress: order, order: o, leg: 0, swap: chain.swap });
    expect(await chain.expectError(f.ixs, [creator], [b.table])).toBe('Unauthorized');
  });

  it('creator cannot rebalance; keeper cannot rebalance out of the vault', async () => {
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const r = await chain.client.rebalanceIx({
      keeper: creator.publicKey,
      bucketAddress: b.address,
      bucket,
      config,
      fromMint: chain.stock('NVDAx').mint,
      toMint: chain.stock('AAPLx').mint,
      qtyIn: 1_000n,
      swap: chain.swap,
    });
    expect(await chain.expectError(r.ixs, [creator], [b.table])).toBe('Unauthorized');

    // keeper points the output at its own account: to_vault receives nothing
    const mine = (await stockAccounts(keeper().publicKey)).get('AAPLx')!;
    const route = await chain.swap.build({
      inputMint: chain.stock('NVDAx').mint,
      outputMint: chain.stock('AAPLx').mint,
      amountIn: 1_000n,
      authority: b.address,
      source: bucket.holdings[0]!.vault,
      destination: mine,
      slippageBps: 100,
    });
    const ix = new TransactionInstruction({ ...r.ixs[0]!, keys: r.ixs[0]!.keys.slice(0, 9).concat(route.keys) });
    ix.keys[0] = { pubkey: keeper().publicKey, isSigner: true, isWritable: false };
    const err = await chain.expectError([ix], [keeper()], [b.table]);
    // either the direction check (vault is on target) or the output check stops it
    expect(['OutputTooLow', 'RebalanceDirection', 'StaleValuation']).toContain(err);
  });

  it('creator cannot claim the platform’s commission, nor the keeper the creator’s', async () => {
    const config = await chain.client.config();
    const bucket = await chain.client.bucket(b.address);
    const creatorAta = getAssociatedTokenAddressSync(bucket.tokenMint, creator.publicKey);
    // platform claim with the creator's account as destination
    const ix = await chain.client.program.methods
      .claimFees(false)
      .accountsPartial({
        signer: creator.publicKey,
        config: chain.client.pdas.config(),
        bucket: b.address,
        feeAccount: chain.client.pdas.platformFee(b.address),
        destination: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    expect(await chain.expectError([ix], [creator])).toBe('Unauthorized');
    const keeperClaim = await chain.client.claimFeesIxs({ signer: keeper().publicKey, payer: keeper().publicKey, bucketAddress: b.address, bucket, config, creator: true });
    expect(await chain.expectError(keeperClaim, [keeper()])).toBe('Unauthorized');
  });

  it('only admin can change the swap allow-list or config', async () => {
    const roles = {
      admin: creator.publicKey,
      keeper: creator.publicKey,
      priceAuthority: creator.publicKey,
      feeWallet: creator.publicKey,
      swapPrograms: [TOKEN_2022_PROGRAM_ID, PublicKey.default, PublicKey.default, PublicKey.default],
    };
    expect(await chain.expectError([await chain.client.setRolesIx(creator.publicKey, roles)], [creator])).toBe('Unauthorized');
    expect(await chain.expectError([await chain.client.updateConfigIx(keeper().publicKey, defaultConfigParams())], [keeper()])).toBe('Unauthorized');
    // config cannot be re-initialized
    const init = await chain.client.initializeConfigIx({ authority: creator.publicKey, usdcMint: chain.usdcMint, params: defaultConfigParams(), roles });
    // the config PDA already exists (system program AccountAlreadyInUse = 0x0), and the creator is not the upgrade authority
    expect(await chain.expectError([init], [creator])).toMatch(/Unauthorized|already in use|custom program error: 0x0/);
  });

  it('after every attack, supply is still fully backed and the backer can exit', async () => {
    const bucket = await chain.client.bucket(b.address);
    const held = chain.tokenBalance(getAssociatedTokenAddressSync(bucket.tokenMint, backer.publicKey));
    expect(held).toBeGreaterThan(0n);
    const { exit } = await import('./flows.js');
    const got = await exit(chain, backer, b, held);
    expect(got).toBeGreaterThan(0n);
  });
});
