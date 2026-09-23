'use client';

import { useSyncExternalStore } from 'react';
import { readGeoBlocked, subscribeGeo } from '@/lib/geo';

/** True once any /v1/tx/* call in this tab returned 451. */
export function useGeoBlocked(): boolean {
  return useSyncExternalStore(subscribeGeo, readGeoBlocked, () => false);
}
