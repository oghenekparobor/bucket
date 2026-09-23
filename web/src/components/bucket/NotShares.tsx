import type { Holding } from '@/lib/api/types';

/**
 * "Pre-IPO tokens are not shares" wording, verbatim from docs/legal/not-shares-notice.md.
 * Picks the variant for the issuers the bucket actually holds.
 */
export function NotSharesText({ holdings }: { holdings: Pick<Holding, 'ticker' | 'source' | 'assetType'>[] }) {
  const pre = holdings.filter((h) => h.assetType === 'pre_ipo');
  if (pre.length === 0) return null;
  const tickers = pre.map((h) => h.ticker).join(', ');
  const hasPre = pre.some((h) => h.source === 'PreStocks');
  const hasTes = pre.some((h) => h.source === 'Tessera');
  const lead = (
    <>
      This bucket holds pre-IPO tokens ({tickers}). <strong>They are not shares.</strong> You get no ownership, votes or
      dividends, and the companies have not approved them.{' '}
    </>
  );
  if (hasPre && hasTes) {
    return (
      <>
        {lead}PreStocks tokens track a company through SPVs or other arrangements, with no claim on them. Tessera T-Tokens are
        unsecured loans, repaid only if the company exits. Both trade thinly and can sit far from the issuer&apos;s mark.
      </>
    );
  }
  if (hasTes) {
    return (
      <>
        {lead}Tessera T-Tokens are unsecured loans, repaid only if the company exits. They trade thinly and can sit far from
        the issuer&apos;s mark.
      </>
    );
  }
  return (
    <>
      {lead}PreStocks tokens track a company through SPVs or other arrangements, with no claim on them. They trade thinly and
      can sit far from the issuer&apos;s mark.
    </>
  );
}

/** One-line variant for builder chips and catalog rows. */
export const NOT_SHARES_ONE_LINE = 'Pre-IPO tokens are not shares: no ownership, no votes, no claim on the company.';
