'use client';

import Link from 'next/link';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import ui from '@/components/ui/ui.module.css';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <PageHeader kicker="ERROR" title="Something went wrong" />
      <PageContent>
        <div className={`${ui.card} ${ui.cardPad}`} style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            This page could not load. If the Bucket API is down, your money is not affected: bucket tokens stay in your wallet
            and can be redeemed on-chain without this app.
          </p>
          {error.digest ? <div className={ui.small}>Reference {error.digest}</div> : null}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className={ui.btnAccent} onClick={reset}>
              Try again
            </button>
            <Link href="/" className={ui.btn}>
              Leaderboard
            </Link>
          </div>
        </div>
      </PageContent>
    </>
  );
}
