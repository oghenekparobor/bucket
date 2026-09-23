'use client';

import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '@/hooks/api';
import type { LegStatus, Order } from '@/lib/api/types';
import m from './modals.module.css';

const LABEL: Record<LegStatus, string> = {
  queued: 'queued',
  swapping: 'swapping…',
  filled: 'filled',
  failed: 'failed · refunded',
  claimed: 'claimed in kind',
};

export function isFinished(o: Order | undefined): boolean {
  return !!o && (o.status === 'done' || o.status === 'refunded');
}

/** Polls GET /v1/orders/:address and renders per-leg status with a progress bar. */
export function useOrder(address: string | null) {
  const q = useApiQuery<Order>(address ? ['order', address] : null, (api) => api.order(address!), {
    refreshInterval: (data) => (isFinished(data) ? 0 : 1000),
    // Keep polling in a background tab so the Done state is ready when the user comes back.
    refreshWhenHidden: true,
    shouldRetryOnError: true,
    errorRetryInterval: 1500,
  });
  const started = useRef<number | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!address) return;
    started.current = Date.now();
    setSlow(false);
    const id = setTimeout(() => setSlow(true), 120_000);
    return () => clearTimeout(id);
  }, [address]);
  return { order: q.data, error: q.error as Error | undefined, slow: slow && !isFinished(q.data) };
}

export function LegList({ order, fallbackLegs }: { order: Order | undefined; fallbackLegs: { ticker: string; weightPct: number }[] }) {
  const legs = order?.legs ?? fallbackLegs.map((l) => ({ ...l, status: 'queued' as LegStatus }));
  const done = legs.filter((l) => l.status === 'filled' || l.status === 'failed' || l.status === 'claimed').length;
  const pct = legs.length ? Math.round((done / legs.length) * 100) : 0;
  return (
    <>
      <ul className={m.legs} aria-live="polite">
        {legs.map((l) => (
          <li key={l.ticker} className={m.leg}>
            <span className={m.legTicker}>
              {l.ticker} · {l.weightPct}%
            </span>
            <span style={{ fontSize: 12, color: l.status === 'filled' ? 'var(--c-ink)' : 'var(--c-grey-400)' }}>{LABEL[l.status]}</span>
          </li>
        ))}
      </ul>
      <div
        className={m.progress}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Order progress"
      >
        <div className={m.progressFill} style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}
