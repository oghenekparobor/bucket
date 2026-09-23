'use client';

import { useMemo, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Phone layout (matches the design's 330px phone mockups). */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 640px)');
}

function roundedNow(intervalMs: number): number {
  return Math.floor(Date.now() / intervalMs) * intervalMs;
}

/** Current time, ticking every `intervalMs` (for countdowns and "x min ago"). */
export function useNow(intervalMs = 60_000): number {
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const id = setInterval(cb, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => roundedNow(intervalMs),
    () => roundedNow(intervalMs),
  );
}
