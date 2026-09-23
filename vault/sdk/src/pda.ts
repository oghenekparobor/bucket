import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { BUCKET_VAULT_PROGRAM_ID, MOCK_SWAP_PROGRAM_ID, SEEDS, TOKEN_PROGRAM_ID } from './constants.js';

const u32le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const find = (seeds: Buffer[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];

/** PDA helpers for bucket_vault. Pass `programId` to target a non-default deployment. */
export class Pdas {
  constructor(readonly programId: PublicKey = BUCKET_VAULT_PROGRAM_ID) {}

  config = () => find([SEEDS.config], this.programId);
  asset = (mint: PublicKey) => find([SEEDS.asset, mint.toBuffer()], this.programId);
  creatorState = (creator: PublicKey) => find([SEEDS.creator, creator.toBuffer()], this.programId);
  bucket = (creator: PublicKey, id: number) => find([SEEDS.bucket, creator.toBuffer(), u32le(id)], this.programId);
  bucketMint = (bucket: PublicKey) => find([SEEDS.bucketMint, bucket.toBuffer()], this.programId);
  creatorFee = (bucket: PublicKey) => find([SEEDS.creatorFee, bucket.toBuffer()], this.programId);
  platformFee = (bucket: PublicKey) => find([SEEDS.platformFee, bucket.toBuffer()], this.programId);
  mintOrder = (bucket: PublicKey, backer: PublicKey, nonce: bigint) =>
    find([SEEDS.mintOrder, bucket.toBuffer(), backer.toBuffer(), u64le(nonce)], this.programId);
  redeemOrder = (bucket: PublicKey, holder: PublicKey, nonce: bigint) =>
    find([SEEDS.redeemOrder, bucket.toBuffer(), holder.toBuffer(), u64le(nonce)], this.programId);

  /** Vault token account of a holding: the bucket PDA's ATA under the mint's token program. */
  vault = (bucket: PublicKey, mint: PublicKey, tokenProgram: PublicKey) =>
    getAssociatedTokenAddressSync(mint, bucket, true, tokenProgram);
  /** USDC escrow of a mint order. */
  escrow = (order: PublicKey, usdcMint: PublicKey) => getAssociatedTokenAddressSync(usdcMint, order, true, TOKEN_PROGRAM_ID);
}

/** PDA helpers for the devnet mock_swap venue. */
export class MockSwapPdas {
  constructor(readonly programId: PublicKey = MOCK_SWAP_PROGRAM_ID) {}
  state = () => find([SEEDS.mockState], this.programId);
  mintAuthority = () => find([SEEDS.mockAuthority], this.programId);
  market = (stockMint: PublicKey) => find([SEEDS.mockMarket, stockMint.toBuffer()], this.programId);
  inventory = (stockMint: PublicKey, tokenProgram: PublicKey) =>
    getAssociatedTokenAddressSync(stockMint, this.mintAuthority(), true, tokenProgram);
}

/** A fresh order nonce: milliseconds since epoch plus a random tail, as u64. */
export const newNonce = (): bigint => (BigInt(Date.now()) << 12n) | BigInt(Math.floor(Math.random() * 4096));
