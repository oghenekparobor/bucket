'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useApiQuery } from '@/hooks/api';
import { useNow } from '@/hooks/useMediaQuery';
import { ago } from '@/lib/format';
import s from './shell.module.css';

function LastSync() {
  const health = useApiQuery(['health'], (api) => api.health(), { refreshInterval: 60_000 });
  const now = useNow(30_000);
  const at = health.data?.lastSync ?? null;
  return (
    <span className={s.sync} suppressHydrationWarning>
      last sync {at ? ago(at, now) : '—'}
    </span>
  );
}

/** Page header from the design: kicker, 30px title, "last sync", New bucket. */
export function PageHeader({
  kicker,
  title,
  mobileKicker,
  children,
}: {
  kicker: string;
  title: ReactNode;
  /** Replaces the kicker on phones (e.g. "SHARED BY @handle" on a bucket page). */
  mobileKicker?: string;
  children?: ReactNode;
}) {
  return (
    <header className={`${s.header} ${mobileKicker ? s.hasMobileKicker : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className={s.kicker}>{kicker}</div>
        {mobileKicker ? <div className={`${s.kicker} ${s.mobileKicker}`}>{mobileKicker}</div> : null}
        <h1 className={s.title}>{title}</h1>
      </div>
      <div className={s.headerRight}>
        {children}
        <LastSync />
        <Link href="/create" className={s.newBtn}>
          New bucket
        </Link>
      </div>
    </header>
  );
}

export function PageContent({ children }: { children: ReactNode }) {
  return (
    <main id="main" className={s.content} tabIndex={-1}>
      {children}
    </main>
  );
}
