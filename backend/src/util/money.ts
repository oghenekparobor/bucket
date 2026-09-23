/**
 * Integer money helpers. USD amounts are micro-dollars (e6) held in bigint; token amounts are raw base
 * units; prices are micro-dollars per whole raw token (docs/architecture.md §1).
 */

export const E6 = 1_000_000n;

export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Parses a DB numeric / JSON string / number into a bigint (truncating any fraction). */
export function big(v: string | number | bigint | null | undefined): bigint {
  if (v === null || v === undefined) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  const s = v.trim();
  const dot = s.indexOf('.');
  return BigInt(dot === -1 ? s : s.slice(0, dot) || '0');
}

/** Exact decimal string → e6 (rounded half away from zero at the 6th decimal). */
export function usdToE6(v: string | number): bigint {
  const s = typeof v === 'number' ? v.toFixed(8) : v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal amount: ${v}`);
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const padded = (frac + '0000000').slice(0, 7);
  let e6 = BigInt(whole) * E6 + BigInt(padded.slice(0, 6));
  if (Number(padded[6]) >= 5) e6 += 1n;
  return neg ? -e6 : e6;
}

/** e6 → decimal string with `dp` decimals (2–6), rounded half away from zero. */
export function formatE6(e6: bigint, dp = 2): string {
  const neg = e6 < 0n;
  let abs = neg ? -e6 : e6;
  const scale = pow10(6 - dp);
  abs = (abs + scale / 2n) / scale; // round
  const unit = pow10(dp);
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(dp, '0');
  const out = dp > 0 ? `${whole}.${frac}` : `${whole}`;
  return neg && abs !== 0n ? `-${out}` : out;
}

/** e6 → JS number of dollars (for charts and percentages only, never for money math). */
export function e6ToNumber(e6: bigint): number {
  return Number(e6) / 1e6;
}

export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('mulDiv: division by zero');
  return (a * b) / c;
}

/** USD value (e6) of `qty` raw units of a mint with `decimals`, at `priceE6` per whole raw token. */
export function valueE6(qty: bigint, priceE6: bigint, decimals: number): bigint {
  return (qty * priceE6) / pow10(decimals);
}

/** Rounds a percentage for JSON output. */
export function roundPct(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
