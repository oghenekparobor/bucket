import { sleep } from './time.js';

export interface FetchResult<T> {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  data: T | null;
  error: string | null;
}

/**
 * GET/POST JSON with a timeout and retry on 429/5xx/network errors. Never throws: callers record the
 * outcome (status, latency, error) as source health.
 */
export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; retries?: number; init?: RequestInit } = {},
): Promise<FetchResult<T>> {
  const { timeoutMs = 10_000, retries = 2, init } = opts;
  let last: FetchResult<T> = { ok: false, status: null, latencyMs: 0, data: null, error: 'not attempted' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = performance.now();
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const latencyMs = Math.round(performance.now() - started);
      if (res.ok) {
        return { ok: true, status: res.status, latencyMs, data: (await res.json()) as T, error: null };
      }
      const body = (await res.text()).slice(0, 300);
      last = { ok: false, status: res.status, latencyMs, data: null, error: `HTTP ${res.status}: ${body}` };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (err) {
      last = {
        ok: false,
        status: null,
        latencyMs: Math.round(performance.now() - started),
        data: null,
        error: (err as Error).message,
      };
    }
    // Rate limits need a longer pause than transient 5xx / network errors.
    if (attempt < retries) await sleep((last.status === 429 ? 2_000 : 750) * 2 ** attempt);
  }
  return last;
}
