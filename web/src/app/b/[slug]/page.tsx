import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { BucketPageClient } from '@/components/bucket/BucketPageClient';
import { creatorName } from '@/components/bucket/common';
import { getApi, isNotFound, ogBucketImage } from '@/lib/api';
import type { BucketDetail } from '@/lib/api/types';
import { config } from '@/lib/config';
import { pct, pctPlain } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

const loadBucket = cache(async (slug: string): Promise<{ detail: BucketDetail | null; mode: 'live' | 'mock' }> => {
  const api = await getApi();
  try {
    return { detail: await api.bucket(slug), mode: api.mode };
  } catch (e) {
    if (isNotFound(e)) return { detail: null, mode: api.mode };
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { detail: d, mode } = await loadBucket(slug).catch(() => ({ detail: null, mode: 'live' as const }));
  // In mock mode the bucket may exist only in this browser; the client fills in the title.
  if (!d) return { title: { absolute: mode === 'mock' ? 'Bucket' : 'Bucket not found · Bucket' } };
  const creator = creatorName(d.creator);
  const top = [...d.holdings]
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, 3)
    .map((h) => `${h.ticker} ${h.weightPct}%`)
    .join(', ');
  const title = `${d.name} by ${creator}`;
  const description = `${d.name} by ${creator}${d.creator.xHandle && d.creator.displayName ? ` (${d.creator.xHandle})` : ''}. 30-day return ${pct(d.returns['30d'])}, max drawdown ${pctPlain(d.maxDrawdown)}. Top holdings: ${top}.`;
  const image = ogBucketImage(config.apiUrl, d.slug);
  const url = `${config.siteUrl}/b/${d.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'Bucket',
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: `${d.name}: ${pct(d.returns['30d'])} over 30 days` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
      creator: d.creator.xHandle ?? undefined,
    },
  };
}

export default async function BucketPage({ params }: Props) {
  const { slug } = await params;
  const { detail, mode } = await loadBucket(slug);
  // Live API: an unknown slug is a real 404. Mock mode: it may be a bucket published in this browser.
  if (!detail && mode === 'live') notFound();
  let chart = null;
  if (detail) {
    const api = await getApi();
    chart = await api.chart(detail.slug, '30d').catch(() => null);
  }
  return <BucketPageClient slug={slug} initial={detail} initialChart={chart} />;
}
