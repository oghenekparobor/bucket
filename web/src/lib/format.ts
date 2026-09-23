/** Formatting helpers. Output mirrors the design's usd()/compact()/pct(). */

export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function usd(v: string | number | null | undefined, dp = 2): string {
  const n = num(v);
  // No "-$0": the sign only shows when the rounded amount is non-zero.
  const sign = n < 0 && Math.abs(n) >= 0.5 * Math.pow(10, -dp) ? '-' : '';
  return (
    sign +
    '$' +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  );
}

/** usd(), but an em dash when the value is unknown (null from the API). */
export function usdOr(v: string | number | null | undefined, dp = 2): string {
  return v === null || v === undefined || v === '' ? '—' : usd(v, dp);
}

/** A balance the API may not know (RPC timeout): null stays null. */
export function maybeNum(v: string | number | null | undefined): number | null {
  return v === null || v === undefined || v === '' ? null : num(v);
}

export function compact(v: string | number | null | undefined): string {
  const n = num(v);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return usd(n, 0);
}

/** Signed percent: +31.4% / -3.2%. Null renders as an em dash (too young to have a return). */
export function pct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(dp) + '%';
}

/** Unsigned percent, e.g. drawdown "-18.6%" or weight "25%". */
export function pctPlain(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(dp) + '%';
}

export function tokens(v: string | number | null | undefined, dp = 3): string {
  return num(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function int(v: string | number | null | undefined): string {
  return Math.round(num(v)).toLocaleString('en-US');
}

export function shortAddr(addr: string | null | undefined, head = 4, tail = 4): string {
  if (!addr) return '';
  if (addr.length <= head + tail + 1) return addr;
  return addr.slice(0, head) + '…' + addr.slice(-tail);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toDate(v: string | number | Date): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  if (/^\d+$/.test(v)) return toDate(Number(v));
  return new Date(v);
}

/** "2 Sep 2026" */
export function dateLong(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2 Sep" */
export function dateShort(v: string | number | Date): string {
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "14 min ago" */
export function ago(v: string | number | Date | null | undefined, now = Date.now()): string {
  if (v === null || v === undefined) return '—';
  const t = toDate(v).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "18h 24m" until a future time. */
export function countdown(v: string | number | Date, now = Date.now()): string {
  const ms = toDate(v).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'moments';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

/** Clean a typed USD amount: digits and one dot, max 2 decimals. */
export function cleanUsdInput(raw: string): string {
  let s = raw.replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return s;
}

/** A decimal string with at most `dp` places, for request bodies. */
export function decimalString(n: number, dp = 6): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const s = n.toFixed(dp);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
