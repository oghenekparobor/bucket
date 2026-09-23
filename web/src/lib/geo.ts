/**
 * Geo-restriction: the backend answers 451 on /v1/tx/* when Bucket is not available in the
 * caller's region. Remembered for the tab so Invest and Publish are disabled up front, while
 * Sell/Redeem stay enabled (holders must always be able to exit). Plain module: safe to import
 * from server code; the React hook lives in hooks/useGeoBlocked.ts.
 */
const KEY = 'bucket.geo451';
const listeners = new Set<() => void>();

export const GEO_MESSAGE = "Bucket isn't available in your region.";

export function markGeoBlocked(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function readGeoBlocked(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function subscribeGeo(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
