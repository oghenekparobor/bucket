'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { ConfirmSheet } from '@/components/modals/ConfirmSheet';
import { EditDiffModal } from '@/components/modals/EditDiffModal';
import { InvestModal } from '@/components/modals/InvestModal';
import { PnlModal } from '@/components/modals/PnlModal';
import { RedeemModal } from '@/components/modals/RedeemModal';
import { rememberBucket } from '@/components/shell/AppShell';
import { Bar, Label, PeriodSwitch, SourceBadge, XVerified, useCopy } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { refreshAfterTx, useApiQuery, usePortfolio } from '@/hooks/api';
import { useNow } from '@/hooks/useMediaQuery';
import { getApi } from '@/lib/api';
import type { BucketDetail, Chart, Period } from '@/lib/api/types';
import { bucketTags, periodAxisStart } from '@/lib/bucket';
import { areaPath, domainOf, linePath, stepPath } from '@/lib/chart';
import { config, explorerUrl, shareLink } from '@/lib/config';
import {
  COMMISSION_PCT,
  COMMISSION_SPLIT_TEXT,
  CREATOR_SHARE_PCT,
  MAX_WEIGHT_PRE_IPO_PCT,
  PLATFORM_SHARE_PCT,
  commissionExample,
} from '@/lib/constants';
import { ago, compact, countdown, dateLong, int, pct, pctPlain, shortAddr, tokens as fmtTokens, usd } from '@/lib/format';
import { useGeoBlocked } from '@/hooks/useGeoBlocked';
import { GEO_MESSAGE } from '@/lib/geo';
import { friendlyError, signAndSubmit, type FriendlyError } from '@/lib/txFlow';
import { creatorName } from './common';
import { NotSharesText } from './NotShares';
import b from './bucket.module.css';

type ModalKind = 'invest' | 'redeem' | 'edit' | 'pnl' | null;

export function BucketView({ initial, initialChart }: { initial: BucketDetail; initialChart: Chart | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const [modal, setModal] = useState<ModalKind>(null);

  const detail = useApiQuery(['bucket', initial.slug], (api) => api.bucket(initial.slug), {
    fallbackData: initial,
    // Poll quickly while the creator's first order is filling, so Invest opens as soon as it lands.
    refreshInterval: (data) => (data?.fundingState === 'awaiting_creator' ? 3_000 : 60_000),
    refreshWhenHidden: true,
  });
  const d = detail.data ?? initial;
  const portfolio = usePortfolio();
  const position = portfolio.data?.positions.find((p) => p.bucket.address === d.address) ?? null;
  const isCreator = !!auth.wallet && auth.wallet === d.creator.wallet;

  useEffect(() => {
    rememberBucket(d.slug, d.name);
  }, [d.slug, d.name]);

  // Share-link attribution, once per tab per bucket.
  useEffect(() => {
    const key = `bucket.click.${d.slug}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
    let ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref && document.referrer) {
      try {
        const host = new URL(document.referrer).host;
        if (host !== window.location.host) ref = host;
      } catch {
        /* ignore */
      }
    }
    void getApi().then((api) => api.linkClick({ slug: d.slug, ref: ref ?? 'direct' }));
  }, [d.slug]);

  const open = useCallback(
    async (kind: Exclude<ModalKind, null>) => {
      if (kind !== 'edit') {
        const w = await requireSignIn();
        if (!w) return;
      }
      setModal(kind);
    },
    [requireSignIn],
  );

  // ?invest=1 / ?sell=1 / ?pnl=1 from the leaderboard and portfolio. Read on the client only, so
  // the server render never suspends on search params.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !auth.ready) return;
    const search = new URLSearchParams(window.location.search);
    const kind: ModalKind = search.get('invest') ? 'invest' : search.get('sell') ? 'redeem' : search.get('pnl') ? 'pnl' : null;
    if (!kind) return;
    handled.current = true;
    router.replace(pathname, { scroll: false });
    void open(kind);
  }, [auth.ready, open, router, pathname]);

  return (
    <div className={b.page}>
      <ShareBar d={d} onPnl={() => void open('pnl')} />
      {d.pendingEdit ? <PendingBanner d={d} onSee={() => setModal('edit')} onExit={() => void open('redeem')} /> : null}
      <PhoneHero d={d} onInvest={() => void open('invest')} authed={auth.authenticated} initialChart={initialChart} />

      <div className={b.cols}>
        <div className={b.left}>
          <HeaderCard d={d} />
          <PriceChartCard d={d} initialChart={initialChart} />
          <HoldingsCard d={d} />
          <div className={b.twoUp}>
            <VersionHistory d={d} />
            <ProofPanel d={d} />
          </div>
        </div>
        <aside className={b.right} aria-label="Invest">
          <InvestPanel
            d={d}
            position={position ? { tokens: position.tokens, value: position.value, gainPct: position.gainPct, gainUsd: position.gainUsd } : null}
            onInvest={() => void open('invest')}
            onRedeem={() => void open('redeem')}
          />
          {isCreator ? <CreatorBox d={d} /> : null}
          {d.preIpoSharePct > 0 ? <PreIpoBox d={d} /> : null}
          <div className={b.notice}>
            {d.ageDays < 30 ? `This bucket is ${d.ageDays} ${d.ageDays === 1 ? 'day' : 'days'} old. A short record says very little. ` : ''}
            Past performance is not a promise. Max drawdown for this bucket is {pctPlain(d.maxDrawdown)}. The creator steers
            weights but can never withdraw, move or redirect your money. <Link href="/legal/risks">Issuer and other risks</Link>
          </div>
        </aside>
      </div>

      <InvestModal open={modal === 'invest'} onClose={() => setModal(null)} bucket={d} onMakePnl={() => setModal('pnl')} />
      <RedeemModal open={modal === 'redeem'} onClose={() => setModal(null)} bucket={d} positionTokens={position?.tokens ?? null} />
      <EditDiffModal open={modal === 'edit'} onClose={() => setModal(null)} bucket={d} onExit={() => void open('redeem')} />
      <PnlModal
        open={modal === 'pnl'}
        onClose={() => setModal(null)}
        bucket={d}
        position={position ? { gainPct: position.gainPct, gainUsd: position.gainUsd } : null}
        wallet={auth.wallet}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ShareBar({ d, onPnl }: { d: BucketDetail; onPnl: () => void }) {
  const link = shareLink(d.slug);
  const { copied, copy } = useCopy();
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), []);
  return (
    <div className={b.shareBar}>
      <span className={ui.label}>Share link</span>
      <span className={b.shareUrl}>{link.display}</span>
      <button type="button" className={ui.btn} onClick={() => copy(link.href)} aria-label="Copy share link">
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {canShare ? (
        <button
          type="button"
          className={ui.btn}
          onClick={() => void navigator.share({ title: d.name, text: `${d.name} on Bucket`, url: link.href }).catch(() => undefined)}
        >
          Share
        </button>
      ) : null}
      <button type="button" className={ui.btnAccent} onClick={onPnl}>
        PnL card
      </button>
      <span className={b.shareNote}>Readable without signing in</span>
    </div>
  );
}

function PendingBanner({ d, onSee, onExit }: { d: BucketDetail; onSee: () => void; onExit: () => void }) {
  const now = useNow(30_000);
  const pe = d.pendingEdit!;
  return (
    <div className={b.pending} role="status">
      <span className={b.pendingLabel}>PENDING EDIT</span>
      <span className={b.pendingText} suppressHydrationWarning>
        v{pe.version} takes effect in {countdown(pe.effectiveAt, now)}. {pe.note ?? ''}
      </span>
      <button type="button" className={ui.btnPaper} onClick={onSee}>
        See the change
      </button>
      <button type="button" className={ui.btn} onClick={onExit}>
        Exit before it lands
      </button>
    </div>
  );
}

function PhoneHero({
  d,
  onInvest,
  authed,
  initialChart,
}: {
  d: BucketDetail;
  onInvest: () => void;
  authed: boolean;
  initialChart: Chart | null;
}) {
  const chart = useApiQuery(['chart', d.slug, '30d'], (api) => api.chart(d.slug, '30d'), {
    fallbackData: initialChart ?? undefined,
  });
  const vals = (chart.data?.points ?? []).map((p) => p.unitPrice);
  const blocked = useInvestBlock(d);
  return (
    <section className={b.hero} aria-label="Summary">
      <div className={b.heroCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Label as="span">30-day return</Label>
          <span style={{ fontSize: 11, color: 'var(--c-grey-500)' }}>max dd {pctPlain(d.maxDrawdown)}</span>
        </div>
        <div className={b.heroRet}>{pct(d.returns['30d'])}</div>
        {vals.length > 1 ? (
          <svg viewBox="0 0 280 70" preserveAspectRatio="none" style={{ width: '100%', height: 70, marginTop: 8, display: 'block' }} aria-hidden="true">
            <path d={areaPath(vals, 280, 70, 4)} fill="var(--c-accent)" fillOpacity={0.32} />
            <path d={linePath(vals, 280, 70, 4)} fill="none" stroke="var(--c-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </div>
      <div className={b.heroCard} style={{ padding: '12px 14px' }}>
        <Label>Holdings</Label>
        {d.holdings.map((h) => (
          <div key={h.mint} className={b.heroHolding}>
            <span className={b.heroTicker}>{h.ticker}</span>
            <div style={{ flex: 1 }}>
              <Bar pct={h.weightPct * 2} accent={h.assetType === 'pre_ipo'} />
            </div>
            <span className={b.heroWeight}>{h.weightPct}%</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={`${blocked ? ui.btnDisabled : ui.btnAccent} ${ui.btnLarge} ${b.heroInvest}`}
        onClick={onInvest}
        disabled={!!blocked}
      >
        {d.status === 'closed' ? 'Closed to new money' : 'Invest'}
      </button>
      {blocked ? (
        <div style={{ fontSize: 12, color: 'var(--c-grey-700)', textAlign: 'center' }} role="status">
          {blocked}
        </div>
      ) : null}
      {!authed && !blocked ? (
        <div style={{ fontSize: 11, color: 'var(--c-grey-500)', textAlign: 'center' }}>
          {config.authMode === 'privy' ? 'Sign in with email, Google, Apple or X' : 'Sign in with a dev wallet (no Privy app configured)'}
        </div>
      ) : null}
    </section>
  );
}

function HeaderCard({ d }: { d: BucketDetail }) {
  const tags = bucketTags(d);
  const premium = d.premiumPct;
  return (
    <section className={`${ui.card} ${ui.cardPad}`} aria-labelledby="bucket-name">
      <div className={b.head}>
        <div style={{ minWidth: 0 }}>
          <h2 id="bucket-name" className={b.name}>
            {d.name}
          </h2>
          <div className={b.creatorRow}>
            <div className={b.avatar} aria-hidden="true" />
            <Link href={`/creator/${d.creator.wallet}`} className={b.creatorName}>
              {creatorName(d.creator)}
            </Link>
            {d.creator.xHandle && d.creator.displayName ? <span className={b.handle}>{d.creator.xHandle}</span> : null}
            {d.creator.xVerified ? <XVerified /> : null}
          </div>
        </div>
        <div className={b.prices}>
          <div>
            <Label>Unit price</Label>
            <div className={b.bigPrice}>{usd(d.unitPrice)}</div>
          </div>
          <div>
            <Label>Pool price</Label>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span className={b.poolPrice}>{d.poolPrice ? usd(d.poolPrice) : '—'}</span>
              {premium !== null ? (
                <span className={b.premium} title="Pool price premium or discount to unit price">
                  {(premium >= 0 ? '+' : '') + premium.toFixed(1)}% vs unit
                </span>
              ) : (
                <span className={b.premium}>no pool yet</span>
              )}
            </div>
          </div>
        </div>
      </div>
      {d.thesis ? <p className={b.thesis}>{d.thesis}</p> : null}
      <ul className={b.tags} aria-label="Tags">
        {tags.map((t) => (
          <li key={t} className={b.tag}>
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PriceChartCard({ d, initialChart }: { d: BucketDetail; initialChart: Chart | null }) {
  const [period, setPeriod] = useState<Period>('30d');
  const chart = useApiQuery(['chart', d.slug, period], (api) => api.chart(d.slug, period), {
    fallbackData: period === '30d' && initialChart ? initialChart : undefined,
    keepPreviousData: true,
  });
  const points = chart.data?.points ?? [];
  const unit = points.map((p) => p.unitPrice);
  const hwm = points.map((p) => p.hwm);
  const paths = useMemo(() => {
    if (unit.length < 2) return null;
    const dom = domainOf(unit, hwm);
    return {
      area: areaPath(unit, 640, 200, 8, dom),
      line: linePath(unit, 640, 200, 8, dom),
      hwm: stepPath(hwm, 640, 200, 8, dom),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.data]);
  const first = unit[0];
  const last = unit[unit.length - 1];
  const stats: { label: string; value: string }[] = [
    { label: '7 days', value: pct(d.returns['7d']) },
    { label: '30 days', value: pct(d.returns['30d']) },
    { label: '90 days', value: pct(d.returns['90d']) },
    { label: 'Since creation', value: pct(d.returns.all) },
    { label: 'Max drawdown', value: pctPlain(d.maxDrawdown) },
    { label: 'Total backed', value: compact(d.totalBacked) },
    { label: 'Holders', value: int(d.holders) },
    { label: 'Age', value: `${d.ageDays} ${d.ageDays === 1 ? 'day' : 'days'}` },
  ];
  return (
    <section className={ui.card} aria-labelledby="chart-title">
      <div className={ui.cardHead}>
        <div>
          <h2 id="chart-title" className={ui.cardTitle}>
            Unit price
          </h2>
          <div className={ui.cardSub}>Vault value ÷ tokens in supply. Deposits and exits do not move it.</div>
        </div>
        <PeriodSwitch value={period} onChange={setPeriod} label="Chart period" />
      </div>
      <div className={b.chartBody}>
        {paths ? (
          <svg
            viewBox="0 0 640 200"
            preserveAspectRatio="none"
            className={b.chart}
            role="img"
            aria-label={`Unit price ${periodAxisStart(period)} ${usd(first)}, today ${usd(last)}. High-water mark ${usd(d.hwm)} shown dashed.`}
          >
            <path d={paths.area} fill="var(--c-accent)" fillOpacity={0.3} />
            <path d={paths.line} fill="none" stroke="var(--c-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <path d={paths.hwm} fill="none" stroke="var(--c-grey-400)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div className={b.chart} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-grey-400)', fontSize: 13 }}>
            {chart.isLoading ? 'Loading chart…' : 'Not enough history yet.'}
          </div>
        )}
        <div className={b.axisRow}>
          <span>{periodAxisStart(period)}</span>
          <span>high-water mark {usd(d.hwm)}</span>
          <span>today</span>
        </div>
        <dl className={b.stats}>
          {stats.map((s) => (
            <div key={s.label} className={b.stat}>
              <dt className={ui.label}>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function HoldingsCard({ d }: { d: BucketDetail }) {
  return (
    <section className={ui.card} aria-labelledby="holdings-title">
      <div className={ui.cardHead}>
        <h2 id="holdings-title" className={ui.cardTitle}>
          Holdings
        </h2>
        <div style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>
          {d.holdings.length} tokens · version v{d.version}
        </div>
      </div>
      <div className={ui.scrollX}>
        <div className={b.hHead} aria-hidden="true">
          <div>TOKEN</div>
          <div>SOURCE</div>
          <div>WEIGHT</div>
          <div style={{ textAlign: 'right' }}>PRICE</div>
          <div style={{ textAlign: 'right' }}>CONTRIBUTION</div>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.holdings.map((h) => {
            const pre = h.assetType === 'pre_ipo';
            return (
              <li key={h.mint} className={b.hCols}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={b.ticker}>{h.ticker}</span>
                    <span className={b.tokenName}>{h.name}</span>
                    {pre ? <span className="visually-hidden">(pre-IPO)</span> : null}
                  </div>
                  {pre ? (
                    <div className={b.markLine}>
                      token {usd(h.price)} · issuer mark {h.markPrice ? usd(h.markPrice) : '—'}
                      {h.markGapPct !== null ? ` · ${h.markGapPct.toFixed(0)}% vs mark` : ''}
                    </div>
                  ) : null}
                </div>
                <div>
                  <SourceBadge source={h.source} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{h.weightPct}%</div>
                  <div style={{ marginTop: 5 }}>
                    <Bar pct={h.weightPct * 2} accent={pre} />
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{usd(h.price)}</div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{pct(h.contributionPct)}</div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function VersionHistory({ d }: { d: BucketDetail }) {
  const versions = [...d.versions].sort((x, y) => y.version - x.version);
  return (
    <section className={ui.card} aria-labelledby="versions-title">
      <div className={ui.cardHead}>
        <h2 id="versions-title" className={ui.cardTitle}>
          Version history
        </h2>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {versions.map((v) => (
          <li key={v.version} className={b.version}>
            <div className={b.versionTop}>
              <span className={b.versionLabel}>
                v{v.version}
                {v.version === d.version ? ' · current' : v.version === 1 ? ' · created' : ''}
              </span>
              <span className={b.versionDate}>{dateLong(v.activatedAt)}</span>
            </div>
            <div className={b.versionChange}>{v.changeSummary}</div>
            {v.note ? <div className={b.versionNote}>&ldquo;{v.note}&rdquo;</div> : null}
          </li>
        ))}
      </ol>
      <div className={ui.cardFoot}>History is written on-chain and cannot be edited or reset.</div>
    </section>
  );
}

function ProofPanel({ d }: { d: BucketDetail }) {
  const now = useNow(30_000);
  const rows: { k: string; v: ReactNode }[] = [
    {
      k: 'Vault',
      v: (
        <a href={explorerUrl('address', d.vault)} target="_blank" rel="noopener noreferrer" title={d.vault}>
          {shortAddr(d.vault, 5, 5)}
        </a>
      ),
    },
    {
      k: 'Token mint',
      v: (
        <a href={explorerUrl('address', d.tokenMint)} target="_blank" rel="noopener noreferrer" title={d.tokenMint}>
          {shortAddr(d.tokenMint, 5, 5)}
        </a>
      ),
    },
    { k: 'Tokens in supply', v: int(d.supply) },
    { k: 'Commission settled', v: <span suppressHydrationWarning>{d.lastSettledAt ? ago(d.lastSettledAt, now) : 'not yet'}</span> },
    { k: 'On-chain events', v: int(d.eventCount) },
  ];
  return (
    <section className={ui.card} aria-labelledby="proof-title">
      <div className={ui.cardHead}>
        <h2 id="proof-title" className={ui.cardTitle}>
          Verify it yourself
        </h2>
        <span className={b.live}>
          <span className={ui.pulse} aria-hidden="true" />
          live
        </span>
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map((r) => (
          <div key={r.k} className={b.proofRow}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
      <div className={ui.cardFoot}>
        Every number on this page is computed from vault holdings and on-chain prices. Nobody can key in a return.
      </div>
    </section>
  );
}

/** Why Invest is disabled, or null: closed, awaiting the creator's first fill, or geo-restricted. */
function useInvestBlock(d: BucketDetail): string | null {
  const geo = useGeoBlocked();
  if (d.status === 'closed') return 'Closed to new money. Redeem stays open.';
  if (geo) return `${GEO_MESSAGE} Selling or redeeming tokens you hold still works.`;
  if (d.fundingState === 'awaiting_creator') return "Opens once the creator's stake has filled.";
  return null;
}

function InvestPanel({
  d,
  position,
  onInvest,
  onRedeem,
}: {
  d: BucketDetail;
  position: { tokens: string; value: string; gainPct: number | null; gainUsd: string } | null;
  onInvest: () => void;
  onRedeem: () => void;
}) {
  const closed = d.status === 'closed';
  const blocked = useInvestBlock(d);
  return (
    <div className={ui.cardInk}>
      <div className={b.panelHead}>
        <h2 className={ui.cardTitle}>Invest in this bucket</h2>
        <div className={ui.cardSub}>{closed ? 'Closed to new money · redeem stays open' : 'Minimum $1 · no lock-up · exit any time'}</div>
      </div>
      <div className={b.panelBody}>
        {position ? (
          <div className={b.position}>
            <Label>Your position</Label>
            <div className={b.posLine}>
              <span>{fmtTokens(position.tokens)} tokens</span>
              <span>{usd(position.value)}</span>
            </div>
            <div className={b.posGain}>
              <span>gain vs what you paid</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {pct(position.gainPct)} · {usd(position.gainUsd, 0)}
              </span>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className={`${blocked ? ui.btnDisabled : ui.btnAccent} ${ui.btnLarge}`}
          onClick={onInvest}
          disabled={!!blocked}
        >
          {closed ? 'Closed to new money' : 'Invest'}
        </button>
        {blocked && !closed ? (
          <div style={{ fontSize: 12, color: 'var(--c-grey-700)', lineHeight: 1.5 }} role="status">
            {blocked}
          </div>
        ) : null}
        {position ? (
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={onRedeem}>
            Sell or redeem
          </button>
        ) : null}
        <div className={b.commission}>
          <Label>Commission</Label>
          <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
            {COMMISSION_PCT}% of any gain above the bucket&rsquo;s previous high, {COMMISSION_SPLIT_TEXT}.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-grey-700)', lineHeight: 1.5, marginTop: 8 }}>
            On $500, a 20% rise in the bucket takes {usd(commissionExample(500), 0)} of your gain as commission (
            {usd(commissionExample(500) * (CREATOR_SHARE_PCT / 100), 0)} to the creator,{' '}
            {usd(commissionExample(500) * (PLATFORM_SHARE_PCT / 100), 0)} to Bucket). Nothing is charged while the bucket sits
            below its high of {usd(d.hwm)}.
          </div>
        </div>
      </div>
    </div>
  );
}

function PreIpoBox({ d }: { d: BucketDetail }) {
  const pre = d.holdings.filter((h) => h.assetType === 'pre_ipo');
  return (
    <div className={b.preBox}>
      <div className={b.preHead}>PRE-IPO EXPOSURE · {d.preIpoSharePct}% OF THIS BUCKET</div>
      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <NotSharesText holdings={d.holdings} /> Each is capped at {MAX_WEIGHT_PRE_IPO_PCT}% of a bucket.
        </div>
        {pre.map((h) => (
          <div key={h.mint} className={b.preRow}>
            <span>{h.ticker}</span>
            <span style={{ color: 'var(--c-grey-500)' }}>
              token {usd(h.price)} · mark {h.markPrice ? usd(h.markPrice) : '—'}
            </span>
            <span>{h.markGapPct !== null ? `${h.markGapPct.toFixed(0)}%` : '—'}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 10 }}>
          Returns and commission use the on-chain token price, because that is what you trade at.
        </div>
      </div>
    </div>
  );
}

function CreatorBox({ d }: { d: BucketDetail }) {
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const [built, setBuilt] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const prepareClose = async () => {
    setError(null);
    const wallet = await requireSignIn();
    if (!wallet) return;
    setPreparing(true);
    try {
      const api = await getApi();
      const res = await api.txCloseBucket({ wallet, token: auth.getAccessToken }, { bucket: d.address });
      setBuilt(res.transaction);
      setSheetOpen(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPreparing(false);
    }
  };

  const confirmClose = async () => {
    if (!built || !auth.wallet) return;
    setError(null);
    try {
      await signAndSubmit([built], { wallet: auth.wallet, token: auth.getAccessToken }, auth.signTransaction, (st) =>
        setWorking(st === 'signing' ? 'Waiting for your signature…' : 'Submitting…'),
      );
      setSheetOpen(false);
      setBuilt(null);
      void refreshAfterTx();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className={ui.card} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Label>You created this bucket</Label>
      {d.status === 'open' ? (
        <>
          <Link href={`/create?edit=${d.slug}`} className={`${ui.btn} ${ui.btnMedium}`}>
            {d.pendingEdit ? 'Edit name or thesis' : 'Edit weights, name or thesis'}
          </Link>
          {d.pendingEdit ? <div className={ui.small}>A weights edit is pending. The next one can be proposed 7 days after it.</div> : null}
          <button type="button" className={`${ui.btnGhost} ${ui.btnMedium}`} onClick={prepareClose} disabled={preparing}>
            {preparing ? 'Preparing…' : 'Close to new money'}
          </button>
          <div className={ui.small}>Edits take effect 24 hours after you propose them, at most one per 7 days. Closing keeps redeem open for every holder.</div>
        </>
      ) : (
        <div className={ui.small}>Closed to new money. It stays on your profile, and holders can redeem at any time.</div>
      )}
      {error && !sheetOpen ? <div className={ui.small} role="alert">{error.message}</div> : null}
      <ConfirmSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        kicker="CLOSE BUCKET"
        action={`Close ${d.name} to new money`}
        amountUsd={0}
        amountCaption="Money moved by this transaction"
        rows={[
          { k: 'New investments', v: 'blocked' },
          { k: 'Redeem', v: 'stays open' },
          { k: 'Creator slot', v: 'freed' },
          { k: 'Record', v: 'kept on your profile' },
        ]}
        note="Closing is permanent. The bucket's history and performance stay public."
        confirmLabel="Confirm and close"
        working={working}
        error={error}
        onConfirm={confirmClose}
      />
    </div>
  );
}
