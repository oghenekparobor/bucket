/**
 * Card layouts in the design's visual language (design/Bucket.dc.html): warm off-white card on an ink
 * frame, Archivo for words, JetBrains Mono for numbers, yellow accent bar, square corners.
 * All text arriving here is already sanitized and length-limited (cards/data.ts).
 */
import { C, type Child, type El, h, MONO, path, rect, SANS, svg } from './h.js';
import { qrPath } from './qr.js';

export interface PreviewCardData {
  name: string;
  creatorLine: string;
  xVerified: boolean;
  return30d: number | null;
  maxDrawdown: number;
  top: { ticker: string; weightPct: number; preIpo: boolean }[];
  shortLink: string;
}

export interface PnlCardData {
  name: string;
  creatorLine: string;
  periodTag: string; // "30 DAYS"
  label: string; // "MY RETURN · 30 DAYS"
  value: string; // "+31.4%"
  dollarsLine: string | null;
  footnote: string;
  shortLink: string;
  qrUrl: string;
}

export function fmtPct(n: number | null, dp = 1): string {
  if (n === null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`;
}

// Archivo's space is narrow at this weight; non-breaking spaces keep the tracked words apart.
const kicker = (text: string, size: number, color: string = C.grey): El =>
  h('div', { fontSize: size, letterSpacing: '0.09em', color, fontWeight: 600, fontFamily: SANS }, text.replace(/ /g, ' '));

/** Largest mono font size (≤ max) at which `text` fits `width` px (JetBrains Mono advance ≈ 0.6em). */
const monoFit = (text: string, width: number, max: number) => Math.min(max, Math.floor(width / (0.6 * Math.max(1, text.length))));

function nameSize(name: string, sizes: [number, number, number]): number {
  return name.length <= 16 ? sizes[0] : name.length <= 28 ? sizes[1] : sizes[2];
}

function creatorRow(line: string, verified: boolean, size: number): El {
  return h(
    'div',
    { alignItems: 'center', marginTop: 12, gap: 14 },
    h('div', { width: size * 0.85, height: size * 0.85, backgroundColor: C.ink }),
    h('div', { fontSize: size, color: C.greyDark, fontFamily: SANS }, line),
    verified &&
      h(
        'div',
        { border: `2px solid ${C.ink}`, backgroundColor: C.yellow, fontSize: size * 0.55, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 9px', fontFamily: SANS },
        'X VERIFIED',
      ),
  );
}

/** 1200×630 share preview: name, creator, 30-day return, top 3 holdings. */
export function previewCard(d: PreviewCardData): El {
  const holdingRows: Child[] = d.top.map((t) =>
    h(
      'div',
      { alignItems: 'center', gap: 18, marginTop: 14 },
      h('div', { width: 190, fontFamily: MONO, fontSize: 26, color: C.ink }, t.ticker),
      h(
        'div',
        { width: 300, height: 12, backgroundColor: C.track },
        h('div', { width: Math.min(300, t.weightPct * 6), height: 12, backgroundColor: t.preIpo ? C.yellow : C.ink }),
      ),
      h('div', { width: 70, justifyContent: 'flex-end', fontFamily: MONO, fontSize: 26, color: C.ink }, `${t.weightPct}%`),
    ),
  );

  return h(
    'div',
    { width: 1200, height: 630, backgroundColor: C.ink, padding: 28 },
    h(
      'div',
      { flex: 1, flexDirection: 'column', backgroundColor: C.card, padding: '40px 52px' },
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center' },
        h('div', { fontSize: 20, letterSpacing: '0.1em', fontWeight: 700, color: C.ink, fontFamily: SANS }, 'BUCKET'),
        h('div', { fontSize: 20, color: C.greyDark, fontFamily: MONO }, d.shortLink),
      ),
      h('div', { height: 2, backgroundColor: C.ink, marginTop: 16, marginBottom: 30 }),
      h(
        'div',
        { flex: 1 },
        h(
          'div',
          { flex: 1, flexDirection: 'column', paddingRight: 40 },
          h('div', { fontSize: nameSize(d.name, [72, 60, 48]), fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.05, color: C.ink, fontFamily: SANS }, d.name),
          creatorRow(d.creatorLine, d.xVerified, 26),
          h('div', { flex: 1 }),
          kicker('TOP HOLDINGS', 16),
          ...holdingRows,
        ),
        h(
          'div',
          { width: 390, flexDirection: 'column', justifyContent: 'flex-end', borderLeft: `2px solid ${C.line}`, paddingLeft: 40 },
          kicker('30-DAY RETURN', 18),
          h('div', { fontFamily: MONO, fontSize: monoFit(fmtPct(d.return30d), 350, 112), fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, marginTop: 10, color: C.ink }, fmtPct(d.return30d)),
          h('div', { height: 16, backgroundColor: C.yellow, marginTop: 22 }),
          h('div', { fontSize: 20, color: C.greyDark, marginTop: 18, fontFamily: SANS }, `Max drawdown ${d.maxDrawdown.toFixed(1)}%`),
        ),
      ),
    ),
  );
}

/** 1080×1350 PnL card: bucket, creator, period, percent return, QR code and short link. */
export function pnlCard(d: PnlCardData): El {
  const qr = qrPath(d.qrUrl);
  const qrSize = 230;
  const linkWidth = 1080 - 2 * 52 - 2 * 72 - qrSize - 36;
  return h(
    'div',
    { width: 1080, height: 1350, backgroundColor: C.ink, padding: 52 },
    h(
      'div',
      { flex: 1, flexDirection: 'column', backgroundColor: C.card, padding: 72 },
      h(
        'div',
        { justifyContent: 'space-between', alignItems: 'center' },
        h('div', { fontSize: 26, letterSpacing: '0.1em', fontWeight: 700, color: C.ink, fontFamily: SANS }, 'BUCKET'),
        h('div', { fontSize: 28, color: C.greyDark, fontFamily: MONO }, d.periodTag),
      ),
      h('div', { height: 2, backgroundColor: C.ink, marginTop: 26, marginBottom: 56 }),
      h('div', { fontSize: nameSize(d.name, [96, 80, 64]), fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.05, color: C.ink, fontFamily: SANS }, d.name),
      h('div', { fontSize: 34, color: C.greyDark, marginTop: 14, fontFamily: SANS }, d.creatorLine),
      h('div', { flex: 1 }),
      kicker(d.label, 26),
      h('div', { fontFamily: MONO, fontSize: monoFit(d.value, 1080 - 2 * 52 - 2 * 72, 190), fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, marginTop: 14, color: C.ink }, d.value),
      d.dollarsLine && h('div', { fontFamily: MONO, fontSize: 40, color: C.body, marginTop: 22 }, d.dollarsLine),
      h('div', { height: 32, backgroundColor: C.yellow, marginTop: 40 }),
      h('div', { flex: 1 }),
      h(
        'div',
        { alignItems: 'flex-end', gap: 36 },
        svg(qrSize, qrSize, `0 0 ${qr.size} ${qr.size}`, rect(0, 0, qr.size, qr.size, C.card), path(qr.d, C.ink)),
        h(
          'div',
          { flexDirection: 'column', paddingBottom: 8, width: linkWidth },
          h('div', { fontFamily: MONO, fontSize: monoFit(d.shortLink, linkWidth, 32), color: C.ink, wordBreak: 'break-all' }, d.shortLink),
          h('div', { fontSize: 24, color: C.greyDark, marginTop: 10, fontFamily: SANS }, d.footnote),
        ),
      ),
    ),
  );
}
