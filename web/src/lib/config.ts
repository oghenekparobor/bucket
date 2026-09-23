/** Runtime configuration, read once from NEXT_PUBLIC_* env (inlined at build time). */

export type ApiModeSetting = 'mock' | 'live' | 'auto';
export type AuthMode = 'privy' | 'dev';
export type Cluster = 'devnet' | 'mainnet-beta';

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || '';
const authSetting = process.env.NEXT_PUBLIC_AUTH_MODE?.trim();
const apiSetting = process.env.NEXT_PUBLIC_API_MODE?.trim();

export const config = {
  /** Public API base, used by the browser and for OG image URLs. */
  apiUrl: trimSlash(process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000'),
  /** API base used by server components (may be an internal URL). */
  serverApiUrl: trimSlash(
    process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000',
  ),
  apiMode: (apiSetting === 'mock' || apiSetting === 'live' ? apiSetting : 'auto') as ApiModeSetting,
  privyAppId,
  privyClientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined,
  /** Dev auth is used when explicitly requested, or automatically when no Privy app id is set. */
  authMode: (authSetting === 'dev' || !privyAppId ? 'dev' : 'privy') as AuthMode,
  cluster: (process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() === 'mainnet-beta'
    ? 'mainnet-beta'
    : 'devnet') as Cluster,
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT?.trim() || null,
  cardFunding: process.env.NEXT_PUBLIC_ENABLE_CARD_FUNDING?.trim() === 'true',
  siteUrl: trimSlash(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000'),
  /**
   * What a share link reads as in the UI. Defaults to the host links actually point at, so the
   * displayed link is never a different address from the one the copy button gives you. Set
   * NEXT_PUBLIC_SHARE_HOST to the production domain once it resolves to this site.
   */
  shareHost:
    process.env.NEXT_PUBLIC_SHARE_HOST?.trim() ||
    trimSlash(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(/^https?:\/\//, ''),
  isProd: process.env.NODE_ENV === 'production',
} as const;

export function explorerUrl(kind: 'address' | 'tx', value: string): string {
  const suffix = config.cluster === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}

/** Share link shown in the UI (host + /b/slug) and the full URL behind it. */
export function shareLink(slug: string): { display: string; href: string } {
  return { display: `${config.shareHost}/b/${slug}`, href: `${config.siteUrl}/b/${slug}` };
}
