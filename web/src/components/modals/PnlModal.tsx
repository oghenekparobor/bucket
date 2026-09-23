'use client';

import { toPng } from 'html-to-image';
import { useEffect, useRef, useState } from 'react';
import { creatorName } from '@/components/bucket/common';
import { Modal } from '@/components/ui/Modal';
import { ErrorNote, Toggle } from '@/components/ui/primitives';
import { QrCode } from '@/components/ui/QrCode';
import ui from '@/components/ui/ui.module.css';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { ogPnlImage } from '@/lib/api';
import type { BucketSummary, Period } from '@/lib/api/types';
import { PERIOD_LABEL } from '@/lib/api/types';
import { periodWords } from '@/lib/bucket';
import { config, shareLink } from '@/lib/config';
import { pct, pctPlain, usd } from '@/lib/format';
import m from './modals.module.css';

type CardPeriod = 'mine' | Period;

export interface PnlPosition {
  gainPct: number | null;
  gainUsd: string;
}

export function PnlModal({
  open,
  onClose,
  bucket,
  position,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  bucket: Pick<BucketSummary, 'name' | 'slug' | 'creator' | 'returns' | 'maxDrawdown'>;
  position: PnlPosition | null;
  wallet: string | null;
}) {
  const isPhone = useIsPhone();
  const [period, setPeriod] = useState<CardPeriod>(position ? 'mine' : '30d');
  const [dollars, setDollars] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPeriod(position ? 'mine' : '30d');
      setDollars(false); // off by default, every time
      setError(null);
      setSaving(false);
    }
  }, [open, position]);

  const link = shareLink(bucket.slug);
  const url = `${link.href}?ref=pnl`;
  const mine = period === 'mine' && !!position;
  const showDollars = mine && dollars;
  const value = mine
    ? showDollars
      ? usd(position!.gainUsd, 0)
      : pct(position!.gainPct)
    : pct(bucket.returns[period === 'mine' ? '30d' : period]);
  const label = mine
    ? showDollars
      ? 'MY GAIN · SINCE I INVESTED'
      : 'MY RETURN · SINCE I INVESTED'
    : `RETURN · ${periodWords(period === 'mine' ? '30d' : period).toUpperCase()}`;
  const corner = mine ? 'MY POSITION' : periodWords(period === 'mine' ? '30d' : period).toUpperCase();
  const by = `${creatorName(bucket.creator)}${bucket.creator.displayName && bucket.creator.xHandle ? ` · ${bucket.creator.xHandle}` : ''}`;
  const text = mine
    ? `My ${showDollars ? 'gain' : 'return'} on ${bucket.name} by ${creatorName(bucket.creator)}: ${value}. Every number is checkable on-chain.`
    : `${bucket.name} by ${creatorName(bucket.creator)}: ${value} ${periodWords(period === 'mine' ? '30d' : period)}. Every number is checkable on-chain.`;
  const enc = encodeURIComponent;
  const shareX = `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`;
  const shareWa = `https://wa.me/?text=${enc(`${text} ${url}`)}`;
  const shareTg = `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`;

  const save = async () => {
    if (!cardRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await Promise.race([
        toPng(cardRef.current, { pixelRatio: 3, cacheBust: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000)),
      ]);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `bucket-${bucket.slug}-pnl.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError('fallback');
    } finally {
      setSaving(false);
    }
  };

  const ogUrl = ogPnlImage(config.apiUrl, bucket.slug, {
    period: period === 'mine' ? '30d' : period,
    wallet: mine ? (wallet ?? undefined) : undefined,
    dollars: showDollars,
  });
  const fallbackNote = error ? (
    <ErrorNote>
      Could not render the image in this browser.{' '}
      <a href={ogUrl} target="_blank" rel="noopener noreferrer">
        Open the server-rendered card
      </a>{' '}
      and save it from there.
    </ErrorNote>
  ) : null;

  const titleId = 'pnl-title';
  const periods: CardPeriod[] = [...(position ? (['mine'] as CardPeriod[]) : []), '7d', '30d', '90d', 'all'];

  const card = (
    <div className={m.pnlFrame}>
      <div ref={cardRef} className={m.pnlCard} aria-label="PnL card preview">
        <div className={m.pnlTop}>
          <span className={ui.labelInk} style={{ letterSpacing: '0.1em' }}>
            BUCKET
          </span>
          <span style={{ fontSize: 11, color: 'var(--c-grey-500)', fontFamily: 'var(--font-mono)' }}>{corner}</span>
        </div>
        <div className={m.pnlRule} />
        <div className={m.pnlName}>{bucket.name}</div>
        <div className={m.pnlBy}>{by}</div>
        <div className={m.pnlGrow} />
        <div className={ui.label}>{label}</div>
        <div className={m.pnlValue}>{value}</div>
        <div className={m.pnlBar} />
        <div className={m.pnlDd}>
          bucket max drawdown {pctPlain(bucket.maxDrawdown)} · Past performance is not a promise.
        </div>
        <div className={m.pnlGrow} />
        <div className={m.pnlFoot}>
          <QrCode value={url} size={isPhone ? 88 : 76} label={`QR code linking to ${link.display}`} />
          <div>
            <div className={m.pnlUrl}>{link.display}</div>
            <div style={{ fontSize: 11, color: 'var(--c-grey-500)', marginTop: 4 }}>
              {showDollars ? 'Dollar amounts shown' : 'Dollar amounts hidden'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const periodPicker = (
    <div className={ui.switch} role="group" aria-label="Card period" style={isPhone ? { borderColor: 'var(--c-on-ink)' } : undefined}>
      {periods.map((p) => (
        <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} style={{ flex: 1 }}>
          {p === 'mine' ? 'MINE' : PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );

  const toggleRow = (
    <div className={m.toggleRow}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }} id="pnl-dollars-label">
          Show dollar amounts
        </div>
        <div className={`${ui.small} ${isPhone ? m.onInkNote : ''}`} style={{ marginTop: 2 }}>
          {mine ? 'Off by default. Percent only.' : 'Only for your own position.'}
        </div>
      </div>
      <Toggle checked={showDollars} onChange={setDollars} label="Show dollar amounts" disabled={!mine} />
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={700} variant={isPhone ? 'dark' : 'sheet'}>
      {isPhone ? (
        <div className={m.pnlWrap}>
          <div className={m.pnlDarkHead}>
            <h2 id={titleId} style={{ fontSize: 14, margin: 0 }}>
              PnL card
            </h2>
            <button type="button" className={`${ui.iconBtn} ${m.pnlClose}`} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          {card}
          <div className={m.pnlPhoneBar}>
            <button type="button" className={`${ui.btn} ${m.phoneGhost}`} style={{ padding: 11, fontSize: 13 }} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save image'}
            </button>
            <a className={ui.btnAccent} style={{ padding: 11, fontSize: 13, fontWeight: 700, borderColor: 'var(--c-accent)' }} href={shareX} target="_blank" rel="noopener noreferrer">
              Share to X
            </a>
          </div>
          <div className={m.pnlSmallLinks}>
            <a className={`${ui.btn} ${m.phoneGhost}`} href={shareWa} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
            <a className={`${ui.btn} ${m.phoneGhost}`} href={shareTg} target="_blank" rel="noopener noreferrer">
              Telegram
            </a>
          </div>
          <div className={m.pnlControls}>
            {periodPicker}
            {toggleRow}
          </div>
          {fallbackNote}
        </div>
      ) : (
        <>
          <div className={ui.dialogHead}>
            <h2 id={titleId} className={ui.dialogTitle}>
              PnL card
            </h2>
            <button type="button" className={ui.iconBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className={m.pnlWrap}>
            {card}
            <div className={m.pnlControls}>
              {periodPicker}
              {toggleRow}
              <a className={`${ui.btnAccent} ${ui.btnMedium}`} style={{ fontWeight: 700, padding: 13 }} href={shareX} target="_blank" rel="noopener noreferrer">
                Share to X
              </a>
              <a className={`${ui.btn} ${ui.btnMedium}`} style={{ padding: 13 }} href={shareWa} target="_blank" rel="noopener noreferrer">
                Share to WhatsApp
              </a>
              <a className={`${ui.btn} ${ui.btnMedium}`} style={{ padding: 13 }} href={shareTg} target="_blank" rel="noopener noreferrer">
                Share to Telegram
              </a>
              <button type="button" className={`${ui.btn} ${ui.btnMedium}`} style={{ padding: 13 }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save as image'}
              </button>
              {fallbackNote}
              <div className={ui.small}>
                The QR and short link open the bucket page, so anyone who sees the card can check the number against chain
                data themselves.
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
