/**
 * Geo-restrictions (checklist 2.7) from config/geo-restrictions.json, copied from the machine-readable
 * lists in docs/legal/geo-restrictions.md. Every /v1/tx/* write is refused with HTTP 451 from a
 * `blockAll` country (or `blockRegionsAll` region), and from a `blockPreIpo` country when the bucket holds
 * or would hold a pre-IPO token. Exits are never blocked: /v1/tx/redeem is exempt, and /v1/tx/submit
 * relays a restricted user's transaction only if Bucket built and sponsored it (after this check) or it
 * contains nothing but exit instructions. The country comes from the edge's geo header; a request
 * without one is not blocked (local development), so production must sit behind Cloudflare or Vercel.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { packageRoot } from '../paths.js';
import { HttpError } from './errors.js';

export interface GeoPolicy {
  blockAll: Set<string>;
  blockPreIpo: Set<string>;
  blockRegionsAll: Set<string>;
}

export interface GeoHeaders {
  country: string[];
  region: string[];
}

/** Bucket-program instructions that only take money out or tidy up; allowed from anywhere. */
export const EXIT_INSTRUCTIONS = new Set([
  'redeem',
  'fill_redeem',
  'claim_redeem_in_kind',
  'close_redeem_order',
  'close_mint_order',
  'settle_commission',
  'claim_fees',
]);

export function loadGeoPolicy(file = join(packageRoot, 'config', 'geo-restrictions.json')): GeoPolicy {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { blockAll: string[]; blockPreIpo: string[]; blockRegionsAll?: string[] };
  return { blockAll: new Set(raw.blockAll), blockPreIpo: new Set(raw.blockPreIpo), blockRegionsAll: new Set(raw.blockRegionsAll ?? []) };
}

function header(req: Pick<FastifyRequest, 'headers'>, names: string[]): string | null {
  for (const name of names) {
    const v = req.headers[name.toLowerCase()];
    const s = (Array.isArray(v) ? v[0] : v)?.trim().toUpperCase();
    if (s) return s;
  }
  return null;
}

/** ISO country and ISO 3166-2 region ("UA-43") of the request, from the edge's geo headers. */
export function locate(req: Pick<FastifyRequest, 'headers'>, h: GeoHeaders): { country: string | null; region: string | null } {
  const country = header(req, h.country);
  const region = header(req, h.region);
  return { country, region: country && region ? (region.includes('-') ? region : `${country}-${region}`) : null };
}

/** Why a write is refused here, or null when it is allowed. */
export function geoBlockReason(policy: GeoPolicy, loc: { country: string | null; region: string | null }, preIpo: boolean): string | null {
  if (!loc.country) return null;
  if (policy.blockAll.has(loc.country) || (loc.region && policy.blockRegionsAll.has(loc.region))) {
    return `Bucket is not available in your location (${loc.region ?? loc.country}). You can still redeem any bucket tokens you hold.`;
  }
  if (preIpo && policy.blockPreIpo.has(loc.country)) {
    return `Buckets holding pre-IPO tokens are not available in your location (${loc.country}). You can still redeem any bucket tokens you hold.`;
  }
  return null;
}

/** True when the location is restricted for any bucket (used to vet relayed transactions). */
export function isRestricted(policy: GeoPolicy, loc: { country: string | null; region: string | null }): boolean {
  return geoBlockReason(policy, loc, true) !== null;
}

export function assertGeoAllowed(req: Pick<FastifyRequest, 'headers'>, policy: GeoPolicy, headers: GeoHeaders, preIpo: boolean): void {
  const reason = geoBlockReason(policy, locate(req, headers), preIpo);
  if (reason) throw new HttpError(451, 'unavailable_for_legal_reasons', reason);
}
