import QRCode from 'qrcode';

/** A real, scannable QR code rendered as crisp SVG (works in server and client components). */
export function QrCode({
  value,
  size = 88,
  fg = 'var(--c-ink)',
  bg = 'var(--c-card)',
  label,
  margin = 1,
}: {
  value: string;
  size?: number;
  fg?: string;
  bg?: string;
  label?: string;
  margin?: number;
}) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const total = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(y, x)) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? `QR code for ${value}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', flex: `0 0 ${size}px` }}
    >
      <rect width={total} height={total} fill={bg} />
      <path d={d} fill={fg} />
    </svg>
  );
}
