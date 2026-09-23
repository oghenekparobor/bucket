'use client';

import Link from 'next/link';
import { creatorName } from '@/components/bucket/common';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import { CopyButton, ErrorNote, Kpi, StatusBadge, XVerified } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { useApiQuery } from '@/hooks/api';
import { isNotFound } from '@/lib/api';
import type { CreatorProfile } from '@/lib/api/types';
import { compact, int, num, pct, pctPlain, shortAddr } from '@/lib/format';
import v from './views.module.css';

/** Every bucket a wallet has made, including closed and losing ones, with drawdown beside every return. */
export function CreatorView({ wallet, initial }: { wallet: string; initial: CreatorProfile | null }) {
  const q = useApiQuery(['creator', wallet], (api) => api.creator(wallet), { fallbackData: initial ?? undefined });
  const p = q.data;

  if (!p) {
    return (
      <>
        <PageHeader kicker="CREATOR" title={shortAddr(wallet)} />
        <PageContent>
          {q.error ? (
            <ErrorNote>{isNotFound(q.error) ? 'No buckets from this wallet yet.' : (q.error as Error).message}</ErrorNote>
          ) : (
            <div className={ui.empty}>Loading…</div>
          )}
        </PageContent>
      </>
    );
  }

  const buckets = [...p.buckets].sort((a, b) => (a.status === b.status ? num(b.totalBacked) - num(a.totalBacked) : a.status === 'open' ? -1 : 1));
  const totalBacked = p.totals.totalBacked ?? String(p.buckets.reduce((a, b) => a + num(b.totalBacked), 0));
  const open = p.totals.openBuckets ?? p.buckets.filter((b) => b.status === 'open').length;
  const closed = p.buckets.length - open;
  const holders = p.totals.holders ?? p.buckets.reduce((a, b) => a + b.holders, 0);
  const losing = p.buckets.filter((b) => (b.returns.all ?? 0) < 0).length;

  return (
    <>
      <PageHeader kicker="CREATOR" title={creatorName(p.creator)} />
      <PageContent>
        <div className={v.stack}>
          <section className={`${ui.card} ${ui.cardPad}`} aria-label="Creator">
            <div className={v.profileHead}>
              <div className={v.avatar} aria-hidden="true" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{creatorName(p.creator)}</span>
                  {p.creator.xHandle ? <span className={ui.mono} style={{ fontSize: 13, color: 'var(--c-grey-500)' }}>{p.creator.xHandle}</span> : null}
                  {p.creator.xVerified ? <XVerified /> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <span className={ui.mono} style={{ fontSize: 12 }} title={p.creator.wallet}>
                    {shortAddr(p.creator.wallet, 6, 6)}
                  </span>
                  <CopyButton text={p.creator.wallet} label="Copy wallet" />
                </div>
              </div>
            </div>
          </section>

          <section className={ui.kpiGrid} aria-label="Record">
            <Kpi label="Total backed" mono accent value={compact(totalBacked)} sub="across every bucket" />
            <Kpi label="Buckets" mono value={int(p.buckets.length)} sub={`${open} open · ${closed} closed`} />
            <Kpi label="Holders" mono value={int(holders)} sub="across open and closed buckets" />
            <Kpi label="Losing buckets" mono value={int(losing)} sub="shown here like every other" />
          </section>

          <section className={ui.card} aria-labelledby="cr-title">
            <div className={ui.cardHead}>
              <h2 id="cr-title" className={ui.cardTitle}>
                Every bucket from this wallet
              </h2>
              <span style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>
                Every bucket this wallet has made is shown, including closed and losing ones. Past performance is not a promise.
              </span>
            </div>
            <div className={ui.scrollX}>
              <div className={`${v.thead} ${v.crCols}`} aria-hidden="true">
                <div>BUCKET</div>
                <div className={v.right}>30D</div>
                <div className={v.right}>90D</div>
                <div className={v.right}>ALL</div>
                <div className={v.right}>MAX DD</div>
                <div className={v.right}>TOTAL BACKED</div>
                <div className={v.right}>HOLDERS</div>
                <div className={v.right}>STATUS</div>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {buckets.map((b) => (
                  <li key={b.address} className={`${v.trow} ${v.crCols}`}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/b/${b.slug}`} className={v.nameLink}>
                        {b.name}
                      </Link>
                      <div style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 2 }}>
                        {b.ageDays} days old{b.eligible ? ' · ranked' : b.status === 'open' ? ' · not ranked yet' : ''}
                      </div>
                    </div>
                    <div className={v.num}>{pct(b.returns['30d'])}</div>
                    <div className={v.num}>{pct(b.returns['90d'])}</div>
                    <div className={v.num}>{pct(b.returns.all)}</div>
                    <div className={v.numMuted}>{pctPlain(b.maxDrawdown)}</div>
                    <div className={v.num}>{compact(b.totalBacked)}</div>
                    <div className={v.num}>{int(b.holders)}</div>
                    <div className={v.right}>
                      <StatusBadge status={b.status} />
                    </div>
                  </li>
                ))}
              </ul>
              {buckets.length === 0 ? <div className={ui.empty}>No buckets yet.</div> : null}
            </div>
          </section>
        </div>
      </PageContent>
    </>
  );
}
