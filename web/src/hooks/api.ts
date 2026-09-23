'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR, { mutate, type SWRConfiguration } from 'swr';
import { useAuth } from '@/auth/AuthContext';
import { getApi, type BucketApi, type Caller } from '@/lib/api';
import type { Dashboard, Me, Portfolio } from '@/lib/api/types';

/** SWR over the resolved API (live or mock). `key` null disables the query. */
export function useApiQuery<T>(
  key: readonly unknown[] | null,
  fn: (api: BucketApi) => Promise<T>,
  opts?: SWRConfiguration<T>,
) {
  return useSWR<T>(key, async () => fn(await getApi()), opts);
}

export function useApiMode(): 'live' | 'mock' | null {
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);
  useEffect(() => {
    let alive = true;
    getApi().then((a) => alive && setMode(a.mode));
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}

export function useCaller(): Caller | null {
  const { wallet, getAccessToken } = useAuth();
  return useMemo(() => (wallet ? { wallet, token: getAccessToken } : null), [wallet, getAccessToken]);
}

export function useMe() {
  const caller = useCaller();
  return useApiQuery<Me>(caller ? ['me', caller.wallet] : null, (api) => api.me(caller!), { refreshInterval: 30_000 });
}

export function usePortfolio() {
  const caller = useCaller();
  return useApiQuery<Portfolio>(caller ? ['portfolio', caller.wallet] : null, (api) => api.portfolio(caller!));
}

export function useDashboard() {
  const caller = useCaller();
  return useApiQuery<Dashboard>(caller ? ['dashboard', caller.wallet] : null, (api) => api.dashboard(caller!));
}

/** Refresh everything that a transaction can change. */
export function refreshAfterTx(): Promise<unknown> {
  return mutate(
    (key) =>
      Array.isArray(key) &&
      ['me', 'portfolio', 'dashboard', 'bucket', 'chart', 'leaderboard', 'creator', 'stats'].includes(String(key[0])),
  );
}
