import type { VersionedTransaction } from '@solana/web3.js';

export type WalletKind = 'embedded' | 'external' | 'dev';

/** One interface over Privy and dev auth. Components only ever use this (via useAuth/useSession). */
export interface AuthState {
  mode: 'privy' | 'dev';
  ready: boolean;
  /** Signed in and a Solana wallet is available to sign with. */
  authenticated: boolean;
  wallet: string | null;
  walletKind: WalletKind | null;
  /** Wallet client label, e.g. "Privy", "Phantom", "Dev keypair". */
  walletLabel: string | null;
  email: string | null;
  xHandle: string | null;
  /** Opens sign-in. Resolves with the wallet once signed in, or null if the user backs out. */
  login: () => Promise<string | null>;
  logout: () => Promise<void>;
  /** Bearer token for the backend: Privy access token, or the dev token from architecture §3. */
  getAccessToken: () => Promise<string | null>;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  /** Privy: opens the export modal (embedded wallets only). Dev: null (the account page reveals the key). */
  exportKey: (() => Promise<void>) | null;
  /** Dev only: the base58 secret key, for export/import into Phantom. */
  revealDevSecret: (() => string) | null;
  linkTwitter: (() => void) | null;
  linkEmail: (() => void) | null;
  /** Card or bank purchase of USDC through Privy funding, when enabled. */
  fundWallet: ((amountUsd?: string) => Promise<void>) | null;
  /** Whether the auth provider already has terms acceptance on record for this user (Privy). */
  termsAcceptedRemote: boolean;
  /** Records terms acceptance with the auth provider when it supports it (Privy). */
  acceptTermsRemote: (() => Promise<void>) | null;
}
