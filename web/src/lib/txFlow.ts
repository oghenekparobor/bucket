/**
 * The one path every transaction takes:
 *   POST /v1/tx/* (base64 v0, fee-payer signed) → in-app confirmation → wallet signs → POST /v1/tx/submit.
 * For mints and redeems the caller then polls GET /v1/orders/:address to drive the Filling UI.
 */
import type { VersionedTransaction } from '@solana/web3.js';
import { ApiError, getApi, type Caller } from './api';
import { decodeTx, encodeTx, signingPlan } from './tx';

export interface FriendlyError {
  message: string;
  /** Show the "Add funds" path. */
  addFunds?: boolean;
}

export function friendlyError(e: unknown): FriendlyError {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const code = e instanceof ApiError ? e.code : null;
  if (e instanceof ApiError && e.status === 451) {
    return { message: "Bucket isn't available in your region. Selling or redeeming tokens you already hold still works." };
  }
  // Before the keyword checks below: the API says "Invalid or expired Privy access token" for a dead
  // session, and "expired" there means the sign-in, not the transaction.
  if (e instanceof ApiError && e.status === 401) {
    return { message: 'Your session expired. Sign in again to continue.' };
  }
  if (code === 'INSUFFICIENT_USDC' || /insufficient (usdc|funds|balance)|not enough usdc/i.test(msg)) {
    return { message: msg && code === 'INSUFFICIENT_USDC' ? `Not enough USDC. ${msg}` : 'Not enough USDC in your wallet for this.', addFunds: true };
  }
  if (/slippage/i.test(msg)) {
    return {
      message:
        'A swap moved more than the 1% slippage bound, so that leg did not fill. Unfilled USDC comes back to your wallet.',
    };
  }
  if (code === 'EXPIRED' || /blockhash|expired/i.test(msg)) {
    return { message: 'This transaction expired before it was confirmed. Nothing was spent. Try again.' };
  }
  if (/reject|denied|declined|cancel|user closed|exited/i.test(msg)) {
    return { message: 'You cancelled the signature. Nothing was sent.' };
  }
  return { message: msg || 'Something went wrong. Nothing was sent.' };
}

export type SignStage = 'signing' | 'submitting';

export interface SubmitOptions {
  /**
   * Indices whose failure must not fail the whole flow. The backend marks the token metadata
   * transaction this way: it is last, cosmetic, and the keeper backfills it. Without this, a creator
   * whose bucket and stake had already landed was told the publish failed.
   */
  optional?: number[];
  /** Called for an optional transaction that was skipped, with the error it failed on. */
  onSkip?: (index: number, error: unknown) => void;
}

/**
 * Sign each transaction the user must sign (relay the ones Bucket fully signed) and submit them in
 * order. Returns the signatures that landed; a skipped optional transaction contributes none.
 */
export async function signAndSubmit(
  transactions: string[],
  caller: Caller,
  sign: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  onStage?: (stage: SignStage, index: number, total: number) => void,
  options: SubmitOptions = {},
): Promise<string[]> {
  const api = await getApi();
  const optional = new Set(options.optional ?? []);
  const signatures: string[] = [];
  for (let i = 0; i < transactions.length; i++) {
    try {
      onStage?.('signing', i, transactions.length);
      const tx = decodeTx(transactions[i]);
      const signed = signingPlan(tx, caller.wallet) === 'sign' ? await sign(tx) : tx;
      onStage?.('submitting', i, transactions.length);
      const { signature } = await api.txSubmit(caller, { transaction: encodeTx(signed) });
      signatures.push(signature);
    } catch (err) {
      if (!optional.has(i)) throw err;
      options.onSkip?.(i, err);
    }
  }
  return signatures;
}
