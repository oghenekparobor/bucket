/**
 * Issuer events that end a token's life (config/issuer-events.json, from docs/legal): conversion
 * deadlines after an IPO and redemption windows after a liquidity event. An affected token is not
 * eligible for new buckets, and buckets that hold one get a daily alert once the deadline is near.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../paths.js';

export interface IssuerEvent {
  mint: string; // mainnet mint (devnet mocks match through mirror_of)
  ticker: string;
  reason: string;
  deadline: string | null; // ISO 8601, null when the issuer has not set it yet
  note: string;
}

let cached: IssuerEvent[] | null = null;

export function issuerEvents(): IssuerEvent[] {
  cached ??= (JSON.parse(readFileSync(join(packageRoot, 'config', 'issuer-events.json'), 'utf8')) as { events: IssuerEvent[] }).events;
  return cached;
}

export function issuerEventFor(mint: string, mirrorOf: string | null): IssuerEvent | undefined {
  return issuerEvents().find((e) => e.mint === mint || e.mint === mirrorOf);
}
