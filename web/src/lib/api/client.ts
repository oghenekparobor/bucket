import { markGeoBlocked } from '../geo';
import type {
  BucketDetail,
  CatalogResponse,
  Chart,
  CreateBucketBody,
  CreateBucketResult,
  CreatorProfile,
  Dashboard,
  Health,
  Leaderboard,
  Me,
  MintQuote,
  Order,
  OrderTxResult,
  Period,
  Portfolio,
  RedeemQuote,
  Source,
  Stats,
  SubmitResult,
  TxResult,
} from './types';

/** Who is calling a write endpoint. Live mode sends the bearer; mock mode reads the wallet. */
export interface Caller {
  wallet: string;
  token: () => Promise<string | null>;
}

export interface BucketApi {
  readonly mode: 'live' | 'mock';
  health(): Promise<Health>;
  catalog(params?: { q?: string; source?: Source }): Promise<CatalogResponse>;
  stats(): Promise<Stats>;
  leaderboard(period: Period): Promise<Leaderboard>;
  bucket(slugOrAddress: string): Promise<BucketDetail>;
  chart(slug: string, period: Period): Promise<Chart>;
  creator(wallet: string): Promise<CreatorProfile>;
  quoteMint(bucket: string, amountUsd: string): Promise<MintQuote>;
  quoteRedeem(bucket: string, tokens: string): Promise<RedeemQuote>;
  order(address: string): Promise<Order>;

  me(c: Caller): Promise<Me>;
  portfolio(c: Caller): Promise<Portfolio>;
  dashboard(c: Caller): Promise<Dashboard>;
  txCreateBucket(c: Caller, body: CreateBucketBody): Promise<CreateBucketResult>;
  txMint(c: Caller, body: { bucket: string; amountUsd: string }): Promise<OrderTxResult>;
  txRedeem(c: Caller, body: { bucket: string; tokens: string }): Promise<OrderTxResult>;
  txCloseBucket(c: Caller, body: { bucket: string }): Promise<TxResult>;
  txProposeEdit(
    c: Caller,
    body: { bucket: string; holdings: { mint: string; weightPct: number }[]; note: string },
  ): Promise<TxResult>;
  /** Name and thesis only (backend route, not yet listed in architecture §3). */
  txUpdateInfo(c: Caller, body: { bucket: string; name: string; thesis: string }): Promise<TxResult>;
  txSubmit(c: Caller, body: { transaction: string }): Promise<SubmitResult>;
  faucet(c: Caller): Promise<{ signature?: string; amountUsd?: string }>;
  setNotifications(c: Caller, body: { email?: string; telegramChatId?: string }): Promise<{ ok?: boolean }>;
  linkClick(body: { slug: string; ref: string }): Promise<void>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/** Bucket tokens have 6 decimals (architecture §1). The wire uses raw base units; the UI uses decimals. */
export const BUCKET_TOKEN_DECIMALS = 6;

/** "12400000" (raw) → "12.4". Strings that already contain a decimal point pass through. */
export function rawToTokens(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '0';
  if (!/^\d+$/.test(raw)) return raw;
  const s = raw.padStart(BUCKET_TOKEN_DECIMALS + 1, '0');
  const int = s.slice(0, -BUCKET_TOKEN_DECIMALS);
  const frac = s.slice(-BUCKET_TOKEN_DECIMALS).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** "12.4" → "12400000" (floored to base units, never rounds up past what the wallet holds). */
export function tokensToRaw(tokens: string): string {
  const [i, f = ''] = tokens.trim().split('.');
  const int = (i || '0').replace(/\D/g, '') || '0';
  const frac = (f.replace(/\D/g, '') + '0'.repeat(BUCKET_TOKEN_DECIMALS)).slice(0, BUCKET_TOKEN_DECIMALS);
  return (BigInt(int) * BigInt(10 ** BUCKET_TOKEN_DECIMALS) + BigInt(frac)).toString();
}

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export class LiveApi implements BucketApi {
  readonly mode = 'live' as const;
  constructor(private readonly base: string) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; caller?: Caller; revalidate?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.caller) {
      const token = await init.caller.token();
      if (!token) throw new ApiError('Sign in to continue.', 401, 'UNAUTHENTICATED');
      headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('Could not reach the Bucket API. Check your connection and try again.', 0, 'NETWORK');
    }
    if (res.status === 451 && typeof window !== 'undefined') {
      // Geo-restricted: remember for the tab (Invest/Publish disabled, Sell/Redeem stay available).
      markGeoBlocked();
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      // Backend error body: { error: <code>, message, details? } (details: string[] or zod issues).
      const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      let message =
        (typeof obj.message === 'string' && obj.message) ||
        (typeof obj.error === 'string' && obj.error) ||
        `Request failed (${res.status})`;
      if (Array.isArray(obj.details) && obj.details.length) {
        const parts = obj.details
          .map((d) => (typeof d === 'string' ? d : d && typeof d === 'object' && 'message' in d ? String((d as { message: unknown }).message) : ''))
          .filter(Boolean);
        if (parts.length) message = `${message}: ${parts.join('; ')}`;
      }
      const code = (typeof obj.code === 'string' && obj.code) || (typeof obj.error === 'string' && obj.error) || null;
      throw new ApiError(message, res.status, code);
    }
    return data as T;
  }

  health() {
    return this.request<Health>('/v1/health');
  }
  catalog(params: { q?: string; source?: Source } = {}) {
    return this.request<CatalogResponse>(`/v1/catalog${qs({ q: params.q, source: params.source })}`);
  }
  stats() {
    return this.request<Stats>('/v1/stats');
  }
  leaderboard(period: Period) {
    return this.request<Leaderboard>(`/v1/leaderboard${qs({ period })}`);
  }
  async bucket(slugOrAddress: string) {
    const d = await this.request<BucketDetail>(`/v1/buckets/${encodeURIComponent(slugOrAddress)}`);
    return { ...d, supply: rawToTokens(d.supply) };
  }
  chart(slug: string, period: Period) {
    return this.request<Chart>(`/v1/buckets/${encodeURIComponent(slug)}/chart${qs({ period })}`);
  }
  creator(wallet: string) {
    return this.request<CreatorProfile>(`/v1/creators/${encodeURIComponent(wallet)}`);
  }
  async quoteMint(bucket: string, amountUsd: string) {
    const q = await this.request<MintQuote>(`/v1/quote/mint${qs({ bucket, amount: amountUsd })}`);
    return { ...q, routes: q.routes.map((r) => ({ ...r, tokensOut: rawToTokens(r.tokensOut) })) };
  }
  quoteRedeem(bucket: string, tokens: string) {
    return this.request<RedeemQuote>(`/v1/quote/redeem${qs({ bucket, tokens: tokensToRaw(tokens) })}`);
  }
  async order(address: string) {
    const o = await this.request<Order>(`/v1/orders/${encodeURIComponent(address)}`);
    return { ...o, tokens: rawToTokens(o.tokens) };
  }
  me(c: Caller) {
    return this.request<Me>('/v1/me', { caller: c });
  }
  async portfolio(c: Caller) {
    const p = await this.request<Portfolio>('/v1/me/portfolio', { caller: c });
    return { ...p, positions: p.positions.map((x) => ({ ...x, tokens: rawToTokens(x.tokens) })) };
  }
  dashboard(c: Caller) {
    return this.request<Dashboard>('/v1/me/dashboard', { caller: c });
  }
  txCreateBucket(c: Caller, body: CreateBucketBody) {
    return this.request<CreateBucketResult>('/v1/tx/create-bucket', { method: 'POST', body, caller: c });
  }
  txMint(c: Caller, body: { bucket: string; amountUsd: string }) {
    return this.request<OrderTxResult>('/v1/tx/mint', { method: 'POST', body, caller: c });
  }
  txRedeem(c: Caller, body: { bucket: string; tokens: string }) {
    return this.request<OrderTxResult>('/v1/tx/redeem', {
      method: 'POST',
      body: { bucket: body.bucket, tokens: tokensToRaw(body.tokens) },
      caller: c,
    });
  }
  txUpdateInfo(c: Caller, body: { bucket: string; name: string; thesis: string }) {
    return this.request<TxResult>('/v1/tx/update-info', { method: 'POST', body, caller: c });
  }
  txCloseBucket(c: Caller, body: { bucket: string }) {
    return this.request<TxResult>('/v1/tx/close-bucket', { method: 'POST', body, caller: c });
  }
  txProposeEdit(
    c: Caller,
    body: { bucket: string; holdings: { mint: string; weightPct: number }[]; note: string },
  ) {
    return this.request<TxResult>('/v1/tx/propose-edit', { method: 'POST', body, caller: c });
  }
  txSubmit(c: Caller, body: { transaction: string }) {
    return this.request<SubmitResult>('/v1/tx/submit', { method: 'POST', body, caller: c });
  }
  faucet(c: Caller) {
    return this.request<{ signature?: string; amountUsd?: string }>('/v1/faucet', { method: 'POST', body: {}, caller: c });
  }
  setNotifications(c: Caller, body: { email?: string; telegramChatId?: string }) {
    return this.request<{ ok?: boolean }>('/v1/me/notifications', { method: 'POST', body, caller: c });
  }
  async linkClick(body: { slug: string; ref: string }) {
    try {
      await this.request<unknown>('/v1/events/link-click', { method: 'POST', body });
    } catch {
      /* attribution is best-effort */
    }
  }
}

/** OpenGraph share preview for a bucket (rendered by the backend). */
export function ogBucketImage(apiBase: string, slug: string): string {
  return `${apiBase}/og/b/${encodeURIComponent(slug)}.png`;
}

export function ogPnlImage(
  apiBase: string,
  slug: string,
  opts: { period: Period; wallet?: string; dollars: boolean },
): string {
  return `${apiBase}/og/pnl/${encodeURIComponent(slug)}.png${qs({
    period: opts.period,
    wallet: opts.wallet,
    dollars: opts.dollars ? '1' : '0',
  })}`;
}
