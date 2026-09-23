'use client';

import type { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import ui from '@/components/ui/ui.module.css';
import { shortAddr } from '@/lib/format';
import { AuthContext } from './AuthContext';
import {
  createDevKeypair,
  devBearer,
  devSessionActive,
  importDevKeypair,
  loadDevKeypair,
  setDevSession,
} from './devKeys';
import type { AuthState } from './types';

/**
 * Dev auth (NEXT_PUBLIC_AUTH_MODE=dev, or no Privy app id): a local ed25519 keypair in
 * localStorage is the wallet. Lets the whole devnet loop run without a Privy app.
 */
export function DevAuthProvider({ children }: { children: ReactNode }) {
  const [kp, setKp] = useState<Keypair | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((w: string | null) => void) | null>(null);

  useEffect(() => {
    const k = loadDevKeypair();
    setKp(k);
    setSignedIn(!!k && devSessionActive());
    setReady(true);
  }, []);

  const finish = useCallback((next: Keypair | null) => {
    if (next) {
      setDevSession(true);
      setKp(next);
      setSignedIn(true);
    }
    setOpen(false);
    resolver.current?.(next ? next.publicKey.toBase58() : null);
    resolver.current = null;
  }, []);

  const login = useCallback(() => {
    if (signedIn && kp) return Promise.resolve(kp.publicKey.toBase58());
    setOpen(true);
    return new Promise<string | null>((res) => {
      resolver.current = res;
    });
  }, [signedIn, kp]);

  const logout = useCallback(async () => {
    setDevSession(false);
    setSignedIn(false);
  }, []);

  const value = useMemo<AuthState>(() => {
    const wallet = signedIn && kp ? kp.publicKey.toBase58() : null;
    return {
      mode: 'dev',
      ready,
      authenticated: !!wallet,
      wallet,
      walletKind: wallet ? 'dev' : null,
      walletLabel: wallet ? 'Dev keypair' : null,
      email: null,
      xHandle: null,
      login,
      logout,
      getAccessToken: async () => (kp && signedIn ? devBearer(kp) : null),
      signTransaction: async (tx: VersionedTransaction) => {
        if (!kp || !signedIn) throw new Error('Sign in first.');
        tx.sign([kp]);
        return tx;
      },
      exportKey: null,
      revealDevSecret: kp && signedIn ? () => bs58.encode(kp.secretKey) : null,
      linkTwitter: null,
      linkEmail: null,
      fundWallet: null,
      termsAcceptedRemote: false,
      acceptTermsRemote: null,
    };
  }, [kp, signedIn, ready, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <DevSignInDialog open={open} existing={kp} onDone={finish} />
    </AuthContext.Provider>
  );
}

function DevSignInDialog({
  open,
  existing,
  onDone,
}: {
  open: boolean;
  existing: Keypair | null;
  onDone: (kp: Keypair | null) => void;
}) {
  const [importing, setImporting] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titleId = 'dev-signin-title';

  const close = () => {
    setImporting(false);
    setSecret('');
    setError(null);
    onDone(null);
  };

  return (
    <Modal open={open} onClose={close} labelledBy={titleId} width={460}>
      <ModalHeader kicker="SIGN IN · DEV MODE" title="Use a local wallet" titleId={titleId} onClose={close} />
      <div className={ui.dialogBody} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          No Privy app is configured, so a keypair kept in this browser acts as your Solana wallet. Use it on devnet
          only. With Privy you would sign in with email, Google, Apple, X or Phantom, Solflare and Backpack.
        </p>
        {existing ? (
          <button type="button" className={`${ui.btnAccent} ${ui.btnMedium}`} onClick={() => onDone(existing)} data-autofocus>
            Continue as <span className={ui.mono}>{shortAddr(existing.publicKey.toBase58())}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`${existing ? ui.btn : ui.btnAccent} ${ui.btnMedium}`}
          onClick={() => onDone(createDevKeypair())}
        >
          {existing ? 'Create a new dev wallet' : 'Create a dev wallet'}
        </button>
        {importing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const kp = importDevKeypair(secret);
                setSecret('');
                setImporting(false);
                setError(null);
                onDone(kp);
              } catch {
                setError('That is not a valid secret key. Paste a base58 key or a JSON byte array.');
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <label htmlFor="dev-secret" className={ui.label}>
              Secret key
            </label>
            <textarea
              id="dev-secret"
              className={ui.input}
              rows={3}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="base58 secret key or [12, 34, …]"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            {error ? <div className={ui.small} role="alert">{error}</div> : null}
            <button type="submit" className={`${ui.btnInk} ${ui.btnMedium}`}>
              Import and sign in
            </button>
          </form>
        ) : (
          <button type="button" className={`${ui.btnGhost} ${ui.btnMedium}`} onClick={() => setImporting(true)}>
            Import a secret key
          </button>
        )}
        <div className={ui.small}>Signing in never needs SOL. Network fees are sponsored.</div>
      </div>
    </Modal>
  );
}
