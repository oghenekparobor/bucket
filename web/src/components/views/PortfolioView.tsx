'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { CreatorLine } from '@/components/bucket/common';
import { PnlModal } from '@/components/modals/PnlModal';
import { ErrorNote, Kpi, Skeleton } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { useMe, usePortfolio } from '@/hooks/api';
import type { Position } from '@/lib/api/types';
import { num, pct, pctPlain, tokens as fmtTokens, usd, usdOr } from '@/lib/format';
import { SignInGate } from './SignInGate';
import v from './views.module.css';

export function PortfolioView() {
  return (
    <SignInGate what="your portfolio">
      <Portfolio />
    </SignInGate>
  );
}

function Portfolio() {
  const { wallet } = useAuth();
  const pf = usePortfolio();
  const me = useMe();
  const [pnl, setPnl] = useState<Position | null>(null);
  const t = pf.data?.totals;
  const rows = pf.data?.positions ?? [];

  return (
    <div className={v.stack}>
      <section className={ui.kpiGrid} aria-label="Totals">
        <Kpi label="Portfolio value" mono accent value={t ? usd(t.value, 0) : '—'} sub={t ? `across ${rows.length} bucket${rows.length === 1 ? '' : 's'}` : ' '} />
        <Kpi label="Total gain" mono value={t ? pct(t.gainPct) : '—'} sub={t ? `${usd(t.gainUsd, 0)} against what you paid` : ' '} />
        <Kpi label="USDC available" mono value={usdOr(me.data?.usdcBalance, 0)} sub={<Link href="/account#add-funds">ready to deploy · add funds</Link>} />
        <Kpi label="Commission paid" mono value={t ? usd(t.commissionPaid, 0) : '—'} sub="only on new highs while you held" />
      </section>

      <section className={ui.card} aria-labelledby="pf-title">
        <div className={ui.cardHead}>
          <h2 id="pf-title" className={ui.cardTitle}>
            Your buckets
          </h2>
          <span style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>
            Held in your wallet as tokens. Transferable and tradable anywhere on Solana.
          </span>
        </div>
        <div className={ui.scrollX}>
          <div className={`${v.thead} ${v.pfCols} ${v.pfHead}`} aria-hidden="true">
            <div>BUCKET</div>
            <div className={v.right}>TOKENS</div>
            <div className={v.right}>UNIT PRICE</div>
            <div className={v.right}>VALUE</div>
            <div className={v.right}>YOUR GAIN</div>
            <div />
          </div>
          {pf.error ? (
            <div style={{ padding: 18 }}>
              <ErrorNote>Could not load your portfolio. {(pf.error as Error).message}</ErrorNote>
            </div>
          ) : null}
          {pf.isLoading ? (
            <div className={`${v.trow} ${v.pfCols}`}>
              <Skeleton w="60%" h={18} />
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton h={28} />
            </div>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((p) => (
              <li key={p.bucket.address} className={`${v.trow} ${v.pfCols}`}>
                <div className={v.cName} style={{ minWidth: 0 }}>
                  <Link href={`/b/${p.bucket.slug}`} className={v.nameLink}>
                    {p.bucket.name}
                  </Link>
                  <CreatorLine creator={p.bucket.creator} />
                </div>
                <div className={`${v.num} ${v.cTokens}`}>
                  <span className={v.mobileInline}>tokens </span>
                  {fmtTokens(p.tokens)}
                </div>
                <div className={`${v.num} ${v.cUnit}`}>{usd(p.unitPrice)}</div>
                <div className={`${v.numBig} ${v.cValue}`}>{usd(p.value)}</div>
                <div className={`${v.num} ${v.cGain}`}>
                  {pct(p.gainPct)} / {usd(p.gainUsd, 0)}
                  <div style={{ fontSize: 11, color: 'var(--c-grey-500)', marginTop: 2, whiteSpace: 'nowrap' }}>
                    bucket max dd {pctPlain(p.bucket.maxDrawdown)}
                  </div>
                </div>
                <div className={`${v.actions} ${v.cActions}`}>
                  <button type="button" className={ui.btn} onClick={() => setPnl(p)}>
                    PnL card
                  </button>
                  <Link href={`/b/${p.bucket.slug}?sell=1`} className={ui.btnAccent} aria-label={`Sell ${p.bucket.name}`}>
                    Sell
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {pf.data && rows.length === 0 ? (
            <div className={ui.empty}>
              You do not hold any buckets yet. <Link href="/">Browse the leaderboard</Link>
            </div>
          ) : null}
        </div>
        <div className={ui.cardFoot}>
          Commission paid to date: {t ? usd(t.commissionPaid, 0) : '—'}. Charged only when a bucket set a new high while you held
          it.
        </div>
      </section>
      {pnl ? (
        <PnlModal
          open
          onClose={() => setPnl(null)}
          bucket={pnl.bucket}
          position={{ gainPct: pnl.gainPct, gainUsd: pnl.gainUsd }}
          wallet={wallet}
        />
      ) : null}
      {me.data && me.data.usdcBalance !== null && num(me.data.usdcBalance) === 0 ? (
        <div className={ui.noticeSunk}>
          Your wallet has no USDC. <Link href="/account#add-funds">Add funds</Link> to invest.
        </div>
      ) : null}
    </div>
  );
}
