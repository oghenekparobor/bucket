'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import ui from '@/components/ui/ui.module.css';
import { useApiMode, useMe } from '@/hooks/api';
import { config } from '@/lib/config';
import { shortAddr, usdOr } from '@/lib/format';
import s from './shell.module.css';

// ---- last viewed bucket (for the "Bucket page" nav item) -------------------------------------

const RECENT_KEY = 'bucket.lastBucket';
const listeners = new Set<() => void>();

export function rememberBucket(slug: string, name: string) {
  try {
    window.sessionStorage.setItem(RECENT_KEY, JSON.stringify({ slug, name }));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

let recentCacheRaw: string | null = null;
let recentCache: { slug: string; name: string } | null = null;
function readRecent(): { slug: string; name: string } | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(RECENT_KEY);
  } catch {
    raw = null;
  }
  if (raw !== recentCacheRaw) {
    recentCacheRaw = raw;
    try {
      recentCache = raw ? (JSON.parse(raw) as { slug: string; name: string }) : null;
    } catch {
      recentCache = null;
    }
  }
  return recentCache;
}

function useRecentBucket() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRecent,
    () => null,
  );
}

// ---- nav -------------------------------------------------------------------------------------

type Tab = 'discover' | 'you';

function tabFor(path: string): Tab {
  return /^\/(portfolio|dashboard|account)/.test(path) ? 'you' : 'discover';
}

function NavItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <li>
      <Link href={href} className={s.navItem} aria-current={active ? 'page' : undefined}>
        <span className={s.navDot} aria-hidden="true" />
        <span className={s.navText}>{label}</span>
      </Link>
    </li>
  );
}

function NavColumn({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname() || '/';
  const tab = tabFor(path);
  const recent = useRecentBucket();
  const { wallet } = useAuth();
  const mode = useApiMode();

  const discover = [
    { href: '/', label: 'Leaderboard', active: path === '/' },
    ...(recent
      ? [{ href: `/b/${recent.slug}`, label: recent.name, active: path === `/b/${recent.slug}` }]
      : []),
    { href: '/create', label: 'Create a bucket', active: path.startsWith('/create') },
  ];
  const you = [
    { href: '/portfolio', label: 'Portfolio', active: path.startsWith('/portfolio') },
    { href: '/dashboard', label: 'Creator dashboard', active: path.startsWith('/dashboard') },
    { href: '/account', label: 'Account', active: path.startsWith('/account') },
  ];
  const extra = [
    ...(wallet ? [{ href: `/creator/${wallet}`, label: 'Your public profile', active: path === `/creator/${wallet}` }] : []),
    { href: '/legal/risks', label: 'Terms and risks', active: path.startsWith('/legal') },
  ];

  return (
    <div onClickCapture={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()} style={{ display: 'contents' }}>
      <div className={s.brand}>
        <Link href="/" className={s.brandName}>
          Bucket
        </Link>
        <span className={s.brandMeta}>v1 · {config.cluster === 'devnet' ? 'devnet' : 'mainnet'}</span>
        {mode === 'mock' ? (
          <span className={s.mockBadge} title="The API is unreachable or NEXT_PUBLIC_API_MODE=mock: showing fixture data">
            MOCK DATA
          </span>
        ) : null}
      </div>
      <div className={s.tabs} role="navigation" aria-label="Sections">
        <Link href="/" className={`${s.tab} ${tab === 'discover' ? s.tabActive : ''}`} aria-current={tab === 'discover' ? 'true' : undefined}>
          Discover
        </Link>
        <Link href="/portfolio" className={`${s.tab} ${tab === 'you' ? s.tabActive : ''}`} aria-current={tab === 'you' ? 'true' : undefined}>
          You
        </Link>
      </div>
      <nav aria-label={tab === 'discover' ? 'Discover' : 'You'}>
        <ul className={s.navList}>
          {(tab === 'discover' ? discover : you).map((n) => (
            <NavItem key={n.href} {...n} />
          ))}
        </ul>
      </nav>
      <div className={s.rule} />
      <nav aria-label="More">
        <ul className={s.navList}>
          {extra.map((n) => (
            <NavItem key={n.href} {...n} />
          ))}
        </ul>
      </nav>
      <div className={s.spacer} />
      <WalletCard />
    </div>
  );
}

function WalletCard() {
  const { authenticated, wallet, ready } = useAuth();
  const { requireSignIn } = useSession();
  const me = useMe();
  return (
    <div className={s.walletCard}>
      <div className={ui.label}>Wallet</div>
      {authenticated && wallet ? (
        <>
          <Link href="/account" className={s.walletAddr} title={wallet}>
            {shortAddr(wallet)}
          </Link>
          <div className={s.walletRow}>
            <span style={{ color: 'var(--c-grey-500)' }}>USDC</span>
            <span style={{ fontWeight: 600 }}>{usdOr(me.data?.usdcBalance)}</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, marginTop: 6, color: 'var(--c-grey-500)' }}>
            Browse freely. Sign in to invest or create.
          </div>
          <button
            type="button"
            className={`${ui.btnAccent} ${ui.btnBlock}`}
            style={{ marginTop: 10 }}
            disabled={!ready}
            onClick={() => void requireSignIn()}
          >
            Sign in
          </button>
        </>
      )}
      <div className={s.walletNote}>Fees sponsored · no SOL needed</div>
    </div>
  );
}

function Rail() {
  const { authenticated, logout } = useAuth();
  const { requireSignIn } = useSession();
  return (
    <div className={s.rail}>
      <Link href="/" className={s.logoLink} aria-label="Bucket home">
        <span className={s.logo} />
      </Link>
      <div className={s.railRule} />
      <Link href="/" className={s.railApp} aria-label="Bucket">
        B
      </Link>
      <Link href="/create" className={s.railNew} aria-label="New bucket">
        +
      </Link>
      <div className={s.spacer} />
      <button
        type="button"
        className={s.railPower}
        aria-label={authenticated ? 'Sign out' : 'Sign in'}
        title={authenticated ? 'Sign out' : 'Sign in'}
        onClick={() => (authenticated ? void logout() : void requireSignIn())}
      >
        ⏻
      </button>
    </div>
  );
}

function TopBar() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const mode = useApiMode();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className={s.topbar}>
      <Link href="/" className={s.logoLink} aria-label="Bucket home">
        <span className={s.logo} />
      </Link>
      <Link href="/" className={s.brandName} style={{ fontSize: 18 }}>
        Bucket
      </Link>
      {mode === 'mock' ? <span className={s.mockBadge}>MOCK</span> : null}
      <button type="button" className={s.menuBtn} onClick={() => setOpen(true)} aria-haspopup="dialog">
        Menu
      </button>
      <Modal open={open} onClose={() => setOpen(false)} labelledBy="menu-title" width={420}>
        <ModalHeader title="Menu" titleId="menu-title" onClose={() => setOpen(false)} />
        <div className={s.drawer}>
          <NavColumn onNavigate={() => setOpen(false)} />
        </div>
      </Modal>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.app}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <Rail />
      <aside className={s.nav} aria-label="Navigation">
        <NavColumn />
      </aside>
      <div className={s.main}>
        <TopBar />
        {children}
      </div>
    </div>
  );
}
