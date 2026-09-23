'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { Skeleton } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import v from './views.module.css';

/** Renders children only for a signed-in wallet; otherwise a sign-in prompt. */
export function SignInGate({ what, children }: { what: string; children: ReactNode }) {
  const { ready, authenticated } = useAuth();
  const { requireSignIn } = useSession();
  if (!ready) {
    return (
      <div className={ui.card} style={{ padding: 20, maxWidth: 520 }}>
        <Skeleton w="60%" h={18} />
        <div style={{ height: 10 }} />
        <Skeleton w="90%" />
      </div>
    );
  }
  if (!authenticated) {
    return (
      <div className={`${ui.card} ${v.gate}`}>
        <h2 className={ui.cardTitle}>Sign in to see {what}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--c-grey-700)' }}>
          Browsing buckets and the leaderboard never needs an account. Everything here lives with your wallet.
        </p>
        <button type="button" className={`${ui.btnAccent} ${ui.btnMedium}`} onClick={() => void requireSignIn()}>
          Sign in
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
