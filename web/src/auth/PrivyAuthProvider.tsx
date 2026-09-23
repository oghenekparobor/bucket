'use client';

import { PrivyProvider, useAcceptTerms, useLogin, usePrivy } from '@privy-io/react-auth';
import {
  toSolanaWalletConnectors,
  useExportWallet,
  useFundWallet,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from '@privy-io/react-auth/solana';
import { VersionedTransaction } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { config } from '@/lib/config';
import { AuthContext } from './AuthContext';
import type { AuthState } from './types';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });
const CHAIN = config.cluster === 'devnet' ? 'solana:devnet' : 'solana:mainnet';

/**
 * Privy sign-in: email, Google, Apple, X and external Solana wallets (Phantom, Solflare, Backpack).
 * Email/social users get an embedded Solana wallet on first login. Privy's own transaction UI is
 * hidden because Bucket shows its own confirmation sheet for every transaction.
 */
export default function PrivyAuthProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={config.privyAppId}
      clientId={config.privyClientId}
      config={{
        loginMethods: ['email', 'google', 'apple', 'twitter', 'wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#1C1C1A',
          walletChainType: 'solana-only',
          walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'],
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
          ethereum: { createOnLogin: 'off' },
          showWalletUIs: false,
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
        legal: { termsAndConditionsUrl: '/legal/terms', privacyPolicyUrl: '/legal/risks' },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function isEmbedded(w: ConnectedStandardSolanaWallet): boolean {
  const sw = w.standardWallet as unknown as { isPrivyWallet?: boolean; name?: string };
  return sw.isPrivyWallet === true || sw.name === 'Privy';
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, logout, getAccessToken, linkTwitter, linkEmail } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();
  const { fundWallet } = useFundWallet();
  const { acceptTerms } = useAcceptTerms();
  const pending = useRef<((w: string | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = useMemo(() => {
    const preferred = user?.wallet?.address;
    return (
      wallets.find((w) => w.address === preferred) ?? wallets.find(isEmbedded) ?? wallets[0] ?? null
    );
  }, [wallets, user?.wallet?.address]);

  const wallet = ready && authenticated && active ? active.address : null;

  const settle = useCallback((w: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current?.(w);
    pending.current = null;
  }, []);

  const { login } = useLogin({
    onError: () => settle(null),
  });

  useEffect(() => {
    if (wallet && pending.current) settle(wallet);
  }, [wallet, settle]);

  const doLogin = useCallback(() => {
    if (wallet) return Promise.resolve(wallet);
    return new Promise<string | null>((resolve) => {
      pending.current = resolve;
      // If the user signs in but no wallet ever appears, give up rather than hang.
      timer.current = setTimeout(() => settle(null), 120_000);
      login();
    });
  }, [wallet, login, settle]);

  const value = useMemo<AuthState>(() => {
    const embedded = active ? isEmbedded(active) : false;
    const twitter = user?.twitter?.username;
    return {
      mode: 'privy',
      ready,
      authenticated: !!wallet,
      wallet,
      walletKind: wallet ? (embedded ? 'embedded' : 'external') : null,
      walletLabel: active ? (embedded ? 'Privy embedded wallet' : active.standardWallet.name) : null,
      email: user?.email?.address ?? null,
      xHandle: twitter ? `@${twitter}` : null,
      login: doLogin,
      logout: async () => {
        await logout();
      },
      getAccessToken,
      signTransaction: async (tx: VersionedTransaction) => {
        if (!active) throw new Error('No wallet connected.');
        const out = await signTransaction({
          transaction: tx.serialize(),
          wallet: active,
          chain: CHAIN,
          options: { uiOptions: { showWalletUIs: false } },
        });
        return VersionedTransaction.deserialize(out.signedTransaction);
      },
      exportKey: wallet && embedded ? () => exportWallet({ address: wallet }) : null,
      revealDevSecret: null,
      linkTwitter: wallet ? () => linkTwitter() : null,
      linkEmail: wallet ? () => linkEmail() : null,
      fundWallet:
        wallet && config.cardFunding
          ? (amountUsd?: string) =>
              fundWallet({ address: wallet, options: { chain: CHAIN, asset: 'USDC', amount: amountUsd } })
          : null,
      termsAcceptedRemote: user?.hasAcceptedTerms === true,
      acceptTermsRemote: async () => {
        await acceptTerms();
      },
    };
  }, [
    active,
    user,
    ready,
    wallet,
    doLogin,
    logout,
    getAccessToken,
    signTransaction,
    exportWallet,
    linkTwitter,
    linkEmail,
    fundWallet,
    acceptTerms,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
