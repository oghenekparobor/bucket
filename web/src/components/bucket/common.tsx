import Link from 'next/link';
import type { BucketSummary, CreatorRef } from '@/lib/api/types';
import { linePath } from '@/lib/chart';
import { shortAddr } from '@/lib/format';
import v from '@/components/views/views.module.css';

export function creatorName(c: CreatorRef): string {
  return c.displayName || (c.xHandle ?? shortAddr(c.wallet));
}

/** "Amara Eze · @amaraonchain [X]" linking to the creator profile. */
export function CreatorLine({ creator, className }: { creator: CreatorRef; className?: string }) {
  return (
    <div className={className ?? v.creatorLine}>
      <Link href={`/creator/${creator.wallet}`}>
        {creatorName(creator)}
        {creator.displayName && creator.xHandle ? ` · ${creator.xHandle}` : ''}
      </Link>
      {creator.xVerified ? (
        <span className={v.verified} title="X handle verified">
          X ✓<span className="visually-hidden"> verified</span>
        </span>
      ) : null}
    </div>
  );
}

export function Sparkline({ values, width = 110, height = 30, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  const d = linePath(values, width - 2, height - 4, 2);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, display: 'block' }}
      role="img"
      aria-label={label ?? 'Trend'}
    >
      <path d={d} fill="none" stroke="var(--c-ink)" strokeWidth={1.5} />
    </svg>
  );
}

export function bucketHref(b: Pick<BucketSummary, 'slug'>): string {
  return `/b/${b.slug}`;
}
