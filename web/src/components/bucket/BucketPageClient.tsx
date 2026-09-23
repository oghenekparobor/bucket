'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { PageContent, PageHeader } from '@/components/shell/PageHeader';
import ui from '@/components/ui/ui.module.css';
import { useApiQuery } from '@/hooks/api';
import { isNotFound } from '@/lib/api';
import type { BucketDetail, Chart } from '@/lib/api/types';
import { BucketView } from './BucketView';
import { creatorName } from './common';

/**
 * Bucket page body. Server-rendered with `initial` for every bucket the API knows; when the server
 * could not find it (e.g. a bucket published moments ago in mock mode) it loads on the client.
 */
export function BucketPageClient({
  slug,
  initial,
  initialChart,
}: {
  slug: string;
  initial: BucketDetail | null;
  initialChart: Chart | null;
}) {
  const q = useApiQuery(initial ? null : ['bucket', slug], (api) => api.bucket(slug));
  const d = initial ?? q.data ?? null;

  // Loaded on the client (server did not know it yet): fix the tab title the server set.
  useEffect(() => {
    if (!initial && q.data) document.title = `${q.data.name} · Bucket`;
  }, [initial, q.data]);

  if (!d) {
    const missing = q.error && isNotFound(q.error);
    return (
      <>
        <PageHeader kicker="BUCKET" title={missing ? 'Bucket not found' : q.error ? 'Could not load this bucket' : 'Loading…'} />
        <PageContent>
          {missing || q.error ? (
            <div className={`${ui.card} ${ui.cardPad}`} style={{ maxWidth: 560 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                {missing
                  ? `There is no bucket at /b/${slug}. Share links are permanent, so check the spelling.`
                  : String((q.error as Error).message)}
              </p>
              <Link href="/" className={ui.btnAccent} style={{ marginTop: 14 }}>
                Browse the leaderboard
              </Link>
            </div>
          ) : (
            <div className={ui.empty}>Loading bucket…</div>
          )}
        </PageContent>
      </>
    );
  }

  const handle = d.creator.xHandle ?? creatorName(d.creator);
  return (
    <>
      <PageHeader kicker="BUCKET" title={d.name} mobileKicker={`SHARED BY ${handle}`} />
      <PageContent>
        <BucketView initial={d} initialChart={initialChart} />
      </PageContent>
    </>
  );
}
