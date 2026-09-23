export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export type Period = '7d' | '30d' | '90d' | 'all';
export const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];

/** Length of a period in days (null for "all"). */
export function periodDays(p: Period): number | null {
  return p === 'all' ? null : Number(p.replace('d', ''));
}

export function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function iso(d: Date | number | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return new Date(d).toISOString();
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
