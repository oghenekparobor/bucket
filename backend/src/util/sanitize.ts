/**
 * Cleans user-controlled text before it reaches a renderer or a notification: strips control, format
 * (zero-width, bidi override), private-use and emoji characters, collapses whitespace and truncates.
 */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = input
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...cleaned];
  if (chars.length <= maxLength) return cleaned;
  return chars.slice(0, Math.max(0, maxLength - 1)).join('').trimEnd() + '…';
}

/** UTF-8 byte length (on-chain limits for name/thesis/note are in bytes). */
export function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}
