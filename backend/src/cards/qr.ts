import QRCode from 'qrcode';

/**
 * A real QR code (error correction M) as one SVG path in module units, plus its size in modules
 * including a 2-module quiet zone.
 */
export function qrPath(text: string): { d: string; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { d, size: n + quiet * 2 };
}
