import type { BucketDetail, Period } from './api/types';
import { dateLong } from './format';

/** Descriptive tags shown under the thesis (the API has no tags field, so they are derived). */
export function bucketTags(d: BucketDetail): string[] {
  const tags: string[] = [];
  const etfShare = d.holdings.filter((h) => h.assetType === 'etf').reduce((a, h) => a + h.weightPct, 0);
  if (d.preIpoSharePct >= 50) tags.push('Pre-IPO heavy');
  else if (d.preIpoSharePct > 0) tags.push('Includes pre-IPO');
  else if (etfShare >= 50) tags.push('Broad market');
  if (d.maxDrawdown <= -20) tags.push('High volatility');
  if (d.status === 'closed') tags.push('Closed to new money');
  if (!d.eligible && d.status === 'open' && d.ageDays < 14) tags.push('Too new to rank');
  tags.push(`${d.holdings.length} tokens`, `Created ${dateLong(d.createdAt)}`);
  return tags;
}

export function periodAxisStart(p: Period): string {
  if (p === 'all') return 'since creation';
  return `${p.replace('d', '')} days ago`;
}

export function periodWords(p: Period): string {
  return p === 'all' ? 'since creation' : `${p.replace('d', '')} days`;
}
