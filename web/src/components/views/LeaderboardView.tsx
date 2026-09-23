'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CreatorLine, Sparkline } from '@/components/bucket/common';
import { ErrorNote, Kpi, PeriodSwitch, Skeleton } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { useApiQuery } from '@/hooks/api';
import type { Leaderboard, Period, Stats } from '@/lib/api/types';
import { compact, int, pct, pctPlain } from '@/lib/format';
import v from './views.module.css';

export function LeaderboardView({ initialStats, initialBoard }: { initialStats: Stats | null; initialBoard: Leaderboard | null }) {
  const [period, setPeriod] = useState<Period>('30d');
  const stats = useApiQuery(['stats'], (api) => api.stats(), { fallbackData: initialStats ?? undefined });
  const board = useApiQuery(['leaderboard', period], (api) => api.leaderboard(period), {
    fallbackData: period === '30d' && initialBoard ? initialBoard : undefined,
    keepPreviousData: true,
  });
  const st = stats.data;
  const rows = board.data?.rows ?? [];

  return (
    <div className={v.stack}>
      <section className={ui.kpiGrid} aria-label="Totals" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Kpi label="Total backed" value={st ? compact(st.totalBacked) : '—'} sub={st ? `across ${int(st.bucketCount)} public buckets` : ' '} />
        <Kpi label="Backers" value={st ? int(st.backers) : '—'} sub={st ? `${st.shareLinkBackerPct}% arrived through a share link` : ' '} />
        <Kpi label="Commission paid" value={st ? compact(st.commissionPaid) : '—'} sub={st ? `to ${int(st.creatorsPaid)} creators, all-time` : ' '} />
        <Kpi label="Median pool gap" value={st ? pctPlain(st.medianPoolGapPct) : '—'} sub="pool price vs unit price" />
      </section>

      <section className={ui.card} aria-labelledby="lb-title">
        <div className={ui.cardHead} style={{ gap: 12 }}>
          <h2 id="lb-title" className={ui.cardTitle}>
            Ranked by return
          </h2>
          <PeriodSwitch value={period} onChange={setPeriod} label="Ranking period" />
        </div>
        <div className={ui.scrollX}>
          <div className={`${v.thead} ${v.lbCols} ${v.lbHead}`} role="presentation">
            <div>#</div>
            <div>BUCKET</div>
            <div>TREND</div>
            <div className={v.right}>RETURN</div>
            <div className={v.right}>MAX DD</div>
            <div className={v.right}>TOTAL BACKED</div>
            <div className={v.right}>BACKERS</div>
            <div />
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-busy={board.isLoading}>
            {board.error && rows.length === 0 ? (
              <li style={{ padding: 18 }}>
                <ErrorNote>Could not load the leaderboard. {String((board.error as Error).message ?? '')}</ErrorNote>
              </li>
            ) : null}
            {!board.data && board.isLoading
              ? Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className={`${v.trow} ${v.lbCols}`}>
                    <Skeleton w={20} />
                    <Skeleton w="70%" h={18} />
                    <Skeleton w={100} h={26} />
                    <Skeleton />
                    <Skeleton />
                    <Skeleton />
                    <Skeleton />
                    <Skeleton h={28} />
                  </li>
                ))
              : null}
            {rows.map((r, i) => (
              <li key={r.address} className={`${v.trow} ${v.lbCols} ${i === 0 ? v.lbHighlight : ''}`} style={i === 0 ? undefined : { background: 'var(--c-card)' }}>
                <div className={`${v.rank} ${v.cRank}`}>{String(r.rank).padStart(2, '0')}</div>
                <div className={v.cName} style={{ minWidth: 0 }}>
                  <Link href={`/b/${r.slug}`} className={v.nameLink}>
                    {r.name}
                  </Link>
                  <CreatorLine creator={r.creator} />
                </div>
                <div className={v.cTrend}>
                  <Sparkline values={r.spark} label={`${r.name} unit price trend, ${pct(r.return)}`} />
                </div>
                <div className={`${v.numBig} ${v.cRet}`}>
                  <span className="visually-hidden">Return </span>
                  {pct(r.return)}
                </div>
                <div className={`${v.numMuted} ${v.cDd}`}>
                  <span className={v.mobileInline}>max dd </span>
                  <span className="visually-hidden">Max drawdown </span>
                  {pctPlain(r.maxDrawdown)}
                </div>
                <div className={`${v.num} ${v.cBacked}`}>{compact(r.totalBacked)}</div>
                <div className={`${v.num} ${v.cHolders}`}>{int(r.holders)}</div>
                <div className={`${v.mobileOnly} ${v.cStats}`} style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>
                  {compact(r.totalBacked)} backed · {int(r.holders)} backers
                </div>
                <Link
                  href={`/b/${r.slug}?invest=1`}
                  className={`${i === 0 ? ui.btnAccent : ui.btn} ${v.cInvest}`}
                  aria-label={`Invest in ${r.name}`}
                >
                  Invest
                </Link>
              </li>
            ))}
            {board.data && rows.length === 0 ? <li className={ui.empty}>No eligible buckets for this period yet.</li> : null}
          </ol>
        </div>
        <div className={ui.cardFoot}>
          Eligible buckets only: 14 days old, $25 creator stake held continuously, every holding above the liquidity floor.
          Updated hourly from chain. Ranked by past return over the period shown. Past performance is not a promise. A rank
          is not a recommendation. <Link href="/legal/past-performance">About these numbers</Link>
        </div>
      </section>
    </div>
  );
}
