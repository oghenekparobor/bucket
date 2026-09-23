'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import ui from '@/components/ui/ui.module.css';
import { useAuth } from './AuthContext';

export const TERMS_VERSION = '2026-09-21-draft';
const KEY = 'bucket.terms.v1';

type TermsRecord = Record<string, { at: string; version: string }>;

function readTerms(): TermsRecord {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') as TermsRecord;
  } catch {
    return {};
  }
}

function writeTerms(wallet: string): string {
  const at = new Date().toISOString();
  try {
    const all = readTerms();
    all[wallet] = { at, version: TERMS_VERSION };
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
  return at;
}

interface Session {
  /**
   * Ensures the user is signed in and has accepted the terms. Only called for the actions that
   * need it: create, invest, PnL card (and the account-only pages). Resolves with the wallet or null.
   */
  requireSignIn: () => Promise<string | null>;
  termsAcceptedAt: string | null;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const waiters = useRef<((w: string | null) => void)[]>([]);
  const { wallet, authenticated, termsAcceptedRemote, acceptTermsRemote, logout, login } = auth;

  // Load acceptance for the signed-in wallet, and open the gate on first sign-in.
  useEffect(() => {
    if (!authenticated || !wallet) {
      setAcceptedAt(null);
      setGateOpen(false);
      return;
    }
    const rec = readTerms()[wallet];
    if (rec && rec.version === TERMS_VERSION) {
      setAcceptedAt(rec.at);
      setGateOpen(false);
    } else if (termsAcceptedRemote) {
      setAcceptedAt(writeTerms(wallet));
      setGateOpen(false);
    } else {
      setAcceptedAt(null);
      setGateOpen(true);
    }
  }, [authenticated, wallet, termsAcceptedRemote]);

  const flush = useCallback((w: string | null) => {
    const list = waiters.current;
    waiters.current = [];
    list.forEach((fn) => fn(w));
  }, []);

  const accept = useCallback(async () => {
    if (!wallet) return;
    setAcceptedAt(writeTerms(wallet));
    setGateOpen(false);
    setChecked(false);
    try {
      await acceptTermsRemote?.();
    } catch {
      /* recorded locally; Privy record is best-effort */
    }
    flush(wallet);
  }, [wallet, acceptTermsRemote, flush]);

  const decline = useCallback(async () => {
    setGateOpen(false);
    setChecked(false);
    await logout();
    flush(null);
  }, [logout, flush]);

  const requireSignIn = useCallback(async () => {
    const w = wallet && authenticated ? wallet : await login();
    if (!w) return null;
    const rec = readTerms()[w];
    if (rec && rec.version === TERMS_VERSION) return w;
    return new Promise<string | null>((resolve) => {
      waiters.current.push(resolve);
      setGateOpen(true);
    });
  }, [wallet, authenticated, login]);

  const value = useMemo<Session>(() => ({ requireSignIn, termsAcceptedAt: acceptedAt }), [requireSignIn, acceptedAt]);
  const titleId = 'terms-title';

  return (
    <SessionContext.Provider value={value}>
      {children}
      <Modal open={gateOpen && !!wallet} onClose={decline} labelledBy={titleId} width={480}>
        <ModalHeader kicker="BEFORE YOU START" title="Terms and risks" titleId={titleId} onClose={decline} />
        <div className={ui.dialogBody} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            Bucket is software. It never holds your money: your wallet holds bucket tokens, and a program holds the
            stocks behind them. Returns can go down as well as up, and past performance is not a promise. Pre-IPO
            tokens are not shares.
          </p>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--c-ink)', flex: '0 0 18px' }}
              data-autofocus
            />
            <span>
              I have read and accept the{' '}
              <Link href="/legal/terms" target="_blank">
                Terms of Service
              </Link>{' '}
              and the{' '}
              <Link href="/legal/risks" target="_blank">
                risk disclosures
              </Link>
              .
            </span>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={decline}>
              Not now
            </button>
            <button
              type="button"
              className={`${checked ? ui.btnAccent : ui.btnDisabled} ${ui.btnMedium}`}
              disabled={!checked}
              onClick={accept}
            >
              Accept and continue
            </button>
          </div>
          <div className={ui.small}>Acceptance is recorded with the date and terms version ({TERMS_VERSION}).</div>
        </div>
      </Modal>
    </SessionContext.Provider>
  );
}
