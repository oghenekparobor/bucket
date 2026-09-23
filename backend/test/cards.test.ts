import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { fmtPct, pnlCard, previewCard } from '../src/cards/layouts.js';
import { qrPath } from '../src/cards/qr.js';
import { renderPng } from '../src/cards/render.js';
import { cleanText } from '../src/util/sanitize.js';

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('card renderer', () => {
  it('renders the 1200×630 share preview as a PNG', async () => {
    const png = await renderPng(
      previewCard({
        name: 'Frontier Labs',
        creatorLine: 'Amara Eze · @amaraonchain',
        xVerified: true,
        return30d: 31.4,
        maxDrawdown: -18.6,
        top: [
          { ticker: 'pOPENAI', weightPct: 25, preIpo: true },
          { ticker: 'NVDAx', weightPct: 25, preIpo: false },
          { ticker: 'pSPACEX', weightPct: 25, preIpo: true },
        ],
        shortLink: 'bucket.xyz/b/frontier-labs',
      }),
      1200,
      630,
    );
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });

  it('renders the 1080×1350 PnL card with a scannable-size QR', async () => {
    const png = await renderPng(
      pnlCard({
        name: 'Picks & Shovels',
        creatorLine: 'Kunle Adeyemi · @kunlebuilds',
        periodTag: '30 DAYS',
        label: 'MY RETURN · 30 DAYS',
        value: '+24.8%',
        dollarsLine: '+$1,240 on $5,000',
        footnote: 'Dollar amounts shown by the holder',
        shortLink: 'bucket.xyz/b/picks-and-shovels',
        qrUrl: 'https://bucket.xyz/b/picks-and-shovels',
      }),
      1080,
      1350,
    );
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 });
  });

  it('encodes a real QR code of the share URL (module grid matches the qrcode library)', () => {
    const url = 'https://bucket.xyz/b/frontier-labs';
    const { d, size } = qrPath(url);
    const modules = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
    expect(size).toBe(modules.size + 4);
    let dark = 0;
    for (let i = 0; i < modules.data.length; i++) dark += modules.data[i] ? 1 : 0;
    expect(d.match(/M/g)!.length).toBe(dark);
  });

  it('formats signed percentages', () => {
    expect(fmtPct(31.44)).toBe('+31.4%');
    expect(fmtPct(-3.2)).toBe('-3.2%');
    expect(fmtPct(null)).toBe('—');
  });
});

describe('renderer input sanitizing', () => {
  it('strips control, bidi and emoji characters, collapses whitespace and truncates', () => {
    expect(cleanText('Moon‮shot 🚀\n\tBucket\u0000', 40)).toBe('Moon shot Bucket');
    expect(cleanText('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(cleanText(42, 10)).toBe('');
  });
});
