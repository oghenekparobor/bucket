'use client';

import Link from 'next/link';
import { useAuth } from '@/auth/AuthContext';
import { Bar, ErrorNote, Kpi, Skeleton, StatusBadge } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { useApiQuery, useDashboard } from '@/hooks/api';
import { COMMISSION_PCT, MAX_ACTIVE_BUCKETS, PLATFORM_SHARE_PCT } from '@/lib/constants';
import { compact, dateShort, int, num, pct, pctPlain, usd } from '@/lib/format';
import { SignInGate } from './SignInGate';
import v from './views.module.css';

export function DashboardView() {
  return (
    <SignInGate what="your creator dashboard">
      <Dashboard />
    </SignInGate>
  );
}

function Dashboard() {
  const { wallet } = useAuth();
  const q = useDashboard();
  const d = q.data;
  const own = d?.buckets ?? [];
  // The bucket the KPIs and chart describe: the creator's largest open bucket.
  const focus = [...own].sort((a, b) => (a.status === b.status ? num(b.totalBacked) - num(a.totalBacked) : a.status === 'open' ? -1 : 1))[0] ?? null;
  // Derived from public endpoints: rank on the 30-day board, and the focus bucket's high-water mark.
  const board = useApiQuery(d ? ['leaderboard', '30d'] : null, (api) => api.leaderboard('30d'));
  const detail = useApiQuery(focus ? ['bucket', focus.slug] : null, (api) => api.bucket(focus!.slug));

  if (q.error) return <ErrorNote>Could not load your dashboard. {(q.error as Error).message}</ErrorNote>;
  if (!d) {
    return (
      <div className={ui.kpiGrid}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={ui.kpi}>
            <Skeleton w="50%" />
            <div style={{ height: 12 }} />
            <Skeleton w="70%" h={26} />
          </div>
        ))}
      </div>
    );
  }

  const ranks = (board.data?.rows ?? []).filter((r) => own.some((b) => b.address === r.address)).map((r) => r.rank);
  const bestRank = ranks.length ? Math.min(...ranks) : null;
  const fd = detail.data;
  const unit = fd ? num(fd.unitPrice) : null;
  const hwm = fd ? num(fd.hwm) : null;
  const belowHighPct = unit !== null && hwm !== null && hwm > 0 && unit < hwm ? ((hwm - unit) / hwm) * 100 : 0;
  // Commission not yet settled: 20% of the rise above the mark on every token, creator's 80% share.
  const unpaid =
    fd && unit !== null && hwm !== null && unit > hwm
      ? (COMMISSION_PCT / 100) * (unit - hwm) * num(fd.supply) * (1 - PLATFORM_SHARE_PCT / 100)
      : 0;

  const bars = d.backersByDay;
  const maxBar = Math.max(1, ...bars.map((x) => x.newBackers));
  const anyShared = bars.some((x) => x.shared);
  const axis = bars.length
    ? [0, Math.round((bars.length - 1) / 3), Math.round(((bars.length - 1) * 2) / 3), bars.length - 1].map((i) => dateShort(bars[i].day))
    : [];
  const funnel = [
    { k: 'Link clicks', v: d.funnel.linkClicks },
    { k: 'Opened the bucket page', v: d.funnel.uniqueVisitors },
    { k: 'Signed in', v: d.funnel.signedInFromLink },
    { k: 'Deposited', v: d.funnel.deposited },
  ];
  const top = Math.max(1, d.funnel.linkClicks);
  const totalHolders = own.reduce((a, b) => a + b.holders, 0);
  const viaLinkPct = totalHolders > 0 ? Math.min(100, Math.round((d.funnel.signedInFromLink / totalHolders) * 100)) : null;
  const active = own.filter((b) => b.status === 'open').length;

  return (
    <div className={v.stack}>
      <section className={ui.kpiGrid} aria-label="Totals">
        <Kpi
          label="Total backed"
          mono
          accent
          value={focus ? compact(focus.totalBacked) : '$0'}
          sub={focus ? `${focus.name}, ${int(focus.holders)} backers` : 'no buckets yet'}
        />
        <Kpi label="Commission earned" mono value={usd(d.commission.creatorShareUsd, 0)} sub={`your ${100 - PLATFORM_SHARE_PCT}% share, all-time`} />
        <Kpi
          label="Unpaid above high"
          mono
          value={fd ? usd(unpaid, 0) : '—'}
          sub={fd ? (belowHighPct > 0 ? `unit price is ${belowHighPct.toFixed(1)}% below its high` : 'settles on the next mint, redeem or daily run') : ' '}
        />
        <Kpi label="Leaderboard" mono value={bestRank !== null ? `#${bestRank}` : '—'} sub={bestRank !== null ? '30-day return' : 'not ranked yet (14 days minimum)'} />
      </section>

      <div className={v.split}>
        <section className={`${ui.card} ${v.splitMain}`} aria-labelledby="backers-title">
          <div className={ui.cardHead}>
            <h2 id="backers-title" className={ui.cardTitle}>
              New backers by day
            </h2>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--c-grey-500)' }}>
              <span>{own.length > 1 ? 'All your buckets' : (focus?.name ?? '')}</span>
              <span>Last 30 days</span>
            </div>
          </div>
          <div style={{ padding: '20px 18px 14px' }}>
            <div
              className={v.bars}
              role="img"
              aria-label={`New backers per day over the last ${bars.length} days; ${bars.reduce((a, x) => a + x.newBackers, 0)} in total`}
            >
              {bars.map((x) => (
                <div key={x.day} className={v.barCol} title={`${dateShort(x.day)}: ${x.newBackers} new backers${x.shared ? ' · shared on X' : ''}`}>
                  <div style={{ background: x.shared ? 'var(--c-accent)' : 'var(--c-ink)', height: `${Math.max(2, (x.newBackers / maxBar) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className={v.axis}>
              {axis.map((a, i) => (
                <span key={i}>{a}</span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 10 }}>
              {anyShared ? 'Yellow bars are days you shared the link on X. ' : ''}
              {viaLinkPct !== null ? `Backers arriving through a share link: ${viaLinkPct}%.` : ''}
            </div>
          </div>
        </section>

        <div className={v.splitSide}>
          <section className={ui.card} aria-labelledby="comm-title">
            <div className={ui.cardHead} style={{ padding: '14px 16px' }}>
              <h2 id="comm-title" className={ui.cardTitle}>
                Commission
              </h2>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <dl style={{ margin: 0 }}>
                {[
                  ['Gross commission, all-time', usd(d.commission.grossUsd, 0)],
                  [`Platform share (${PLATFORM_SHARE_PCT}%)`, `−${usd(d.commission.platformShareUsd, 0)}`],
                  ['Your share, paid in tokens', usd(d.commission.creatorShareUsd, 0)],
                  [
                    'Last settlement',
                    d.commission.lastSettlement
                      ? `${dateShort(d.commission.lastSettlement.at)} · ${usd(d.commission.lastSettlement.amountUsd, 0)}`
                      : 'none yet',
                  ],
                  ['High-water mark', fd ? usd(fd.hwm) : '—'],
                ].map(([k, val]) => (
                  <div key={k} className={ui.row} style={{ padding: '8px 0', borderBottom: '1px solid var(--c-line-soft)' }}>
                    <dt>{k}</dt>
                    <dd style={{ margin: 0 }}>{val}</dd>
                  </div>
                ))}
              </dl>
              <div style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 10, lineHeight: 1.5 }}>
                Paid in newly minted bucket tokens when unit price passes its high. You hold, redeem or sell them like any other
                holder.
              </div>
            </div>
          </section>
          <section className={ui.card} aria-labelledby="funnel-title">
            <div className={ui.cardHead} style={{ padding: '14px 16px' }}>
              <h2 id="funnel-title" className={ui.cardTitle}>
                Link to deposit
              </h2>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {funnel.map((f) => (
                <div key={f.k}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{f.k}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{int(f.v)}</span>
                  </div>
                  <div style={{ marginTop: 5 }}>
                    <Bar pct={(f.v / top) * 100} height={10} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className={ui.card} aria-labelledby="own-title">
        <div className={ui.cardHead}>
          <h2 id="own-title" className={ui.cardTitle}>
            Your buckets
          </h2>
          <span style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>
            Closed and losing buckets stay on your profile. {active} of {MAX_ACTIVE_BUCKETS} wallet slots used.{' '}
            {wallet ? <Link href={`/creator/${wallet}`}>View public profile</Link> : null}
          </span>
        </div>
        <div className={ui.scrollX}>
          <div className={`${v.thead} ${v.ownCols}`} aria-hidden="true">
            <div>BUCKET</div>
            <div className={v.right}>30D RETURN</div>
            <div className={v.right}>MAX DD</div>
            <div className={v.right}>TOTAL BACKED</div>
            <div className={v.right}>HOLDERS</div>
            <div className={v.right}>STATUS</div>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {own.map((b) => (
              <li key={b.address} className={`${v.trow} ${v.ownCols}`} style={{ padding: '13px 18px' }}>
                <Link href={`/b/${b.slug}`} className={v.nameLink}>
                  {b.name}
                </Link>
                <div className={v.num}>{pct(b.returns['30d'])}</div>
                <div className={v.numMuted}>{pctPlain(b.maxDrawdown)}</div>
                <div className={v.num}>{compact(b.totalBacked)}</div>
                <div className={v.num}>{int(b.holders)}</div>
                <div className={v.right}>
                  <StatusBadge status={b.status} />
                </div>
              </li>
            ))}
          </ul>
          {own.length === 0 ? (
            <div className={ui.empty}>
              You have not published a bucket yet. <Link href="/create">Create one</Link>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
