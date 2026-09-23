/**
 * Picks the API implementation. NEXT_PUBLIC_API_MODE=mock|live forces one; `auto` (default) uses
 * the live API in production and, in development, falls back to mock fixtures when
 * GET /v1/health does not answer within 1.5 s.
 */
import { config } from '../config';
import { LiveApi, type BucketApi } from './client';
import { MockApi } from './mock/server';

let cached: { api: BucketApi; at: number } | null = null;
let inflight: Promise<BucketApi> | null = null;
const SERVER_TTL_MS = 30_000;

async function probe(base: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${base}/v1/health`, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function getApi(): Promise<BucketApi> {
  const isServer = typeof window === 'undefined';
  const base = isServer ? config.serverApiUrl : config.apiUrl;
  if (config.apiMode === 'mock') return (cached ??= { api: new MockApi(), at: Date.now() }).api;
  if (config.apiMode === 'live' || config.isProd) return (cached ??= { api: new LiveApi(base), at: Date.now() }).api;

  if (cached && (!isServer || Date.now() - cached.at < SERVER_TTL_MS)) return cached.api;
  inflight ??= probe(base)
    .then((up) => {
      const api: BucketApi = up ? new LiveApi(base) : new MockApi();
      if (!up && !isServer) console.info('[bucket] API unreachable at %s, using mock data', base);
      cached = { api, at: Date.now() };
      return api;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export { ApiError, isNotFound, ogBucketImage, ogPnlImage } from './client';
export type { BucketApi, Caller } from './client';
