import type { Metadata } from 'next';
import { creatorName } from '@/components/bucket/common';
import { CreatorView } from '@/components/views/CreatorView';
import { getApi, isNotFound } from '@/lib/api';
import type { CreatorProfile } from '@/lib/api/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ wallet: string }> };

async function load(wallet: string): Promise<CreatorProfile | null> {
  const api = await getApi();
  try {
    return await api.creator(wallet);
  } catch (e) {
    if (isNotFound(e)) return null;
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { wallet } = await params;
  const p = await load(wallet);
  if (!p) return { title: 'Creator' };
  const name = creatorName(p.creator);
  return {
    title: `${name} · creator`,
    description: `Every bucket ${name} has made on Bucket, including closed and losing ones, with drawdown beside every return.`,
  };
}

export default async function CreatorPage({ params }: Props) {
  const { wallet } = await params;
  const initial = await load(wallet);
  return <CreatorView wallet={wallet} initial={initial} />;
}
