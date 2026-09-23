import { createHash } from 'node:crypto';

/**
 * Share-link attribution without storing IPs: link clicks and later mint requests are matched on salted
 * hashes of the client IP and user agent (within 7 days). A heuristic: clients behind the same NAT with
 * the same browser build are indistinguishable.
 */
export function hashClient(value: string): string {
  return createHash('sha256').update(`bucket-link:${value}`).digest('hex').slice(0, 32);
}
