/**
 * Program events (docs/architecture.md §2.3, plus FeesClaimed and BucketInfoUpdated) in the normalized form @bucket/sdk's
 * decoder produces and the indexer stores: snake_case field names, u64/i64 as decimal strings, pubkeys
 * as base58, enums as their variant name. `(mint, x)` pairs are `{ mint, weight_bps }` (holdings) or
 * `{ mint, amount }` (order legs: budget for mints, quantity for redeems), as in the program IDL.
 */

export const EVENT_NAMES = [
  'ConfigUpdated',
  'AssetAdded',
  'AssetUpdated',
  'PriceUpdated',
  'BucketCreated',
  'BucketInfoUpdated',
  'MintOpened',
  'MintFilled',
  'MintClosed',
  'Redeemed',
  'RedeemFilled',
  'RedeemClaimed',
  'RedeemClosed',
  'CommissionSettled',
  'FeesClaimed',
  'BucketClosed',
  'EditProposed',
  'EditActivated',
  'Rebalanced',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export type EventData = Record<string, unknown>;

export interface DecodedEvent {
  name: EventName;
  data: EventData;
}

/** An event with its chain position, ready to insert. */
export interface RawEvent extends DecodedEvent {
  signature: string;
  slot: number;
  eventIndex: number;
  blockTime: Date;
  fixture?: boolean;
}

/** An event as stored (has an id) and handed to the projection. */
export interface StoredEvent extends RawEvent {
  id: number;
}

export function isEventName(name: string): name is EventName {
  return (EVENT_NAMES as readonly string[]).includes(name);
}

// ─── Typed field access ───────────────────────────────────────────────────────────────────────────────

export class EventShapeError extends Error {}

function field(d: EventData, key: string): unknown {
  const v = d[key];
  if (v === undefined || v === null) throw new EventShapeError(`missing field ${key}`);
  return v;
}

export function str(d: EventData, key: string): string {
  return String(field(d, key));
}

export function optStr(d: EventData, key: string): string | null {
  const v = d[key];
  return v === undefined || v === null || v === '' ? null : String(v);
}

export function u64(d: EventData, key: string): bigint {
  const v = field(d, key);
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  return BigInt(String(v));
}

export function optU64(d: EventData, key: string): bigint | null {
  return d[key] === undefined || d[key] === null ? null : u64(d, key);
}

export function int(d: EventData, key: string): number {
  return Number(field(d, key));
}

export function bool(d: EventData, key: string): boolean | null {
  const v = d[key];
  if (v === undefined || v === null) return null;
  return v === true || v === 'true' || v === 1;
}

/** Event timestamp (unix seconds field `ts`) in ms, falling back to the block time. */
export function eventTimeMs(ev: RawEvent, key = 'ts'): number {
  const v = ev.data[key];
  if (v !== undefined && v !== null && String(v) !== '0') return Number(v) * 1000;
  return ev.blockTime.getTime();
}

/** `(mint, x)` pairs arrive as structs `{ mint, <x> }` or as 2-tuples. */
export function pairs(d: EventData, key: string, second: string): { mint: string; value: bigint }[] {
  const v = field(d, key);
  if (!Array.isArray(v)) throw new EventShapeError(`${key} is not an array`);
  return v.map((item) => {
    if (Array.isArray(item)) return { mint: String(item[0]), value: BigInt(String(item[1])) };
    const o = item as Record<string, unknown>;
    return { mint: String(o.mint), value: BigInt(String(o[second])) };
  });
}

export function holdingsOf(d: EventData, key = 'holdings'): { mint: string; weight_bps: number }[] {
  return pairs(d, key, 'weight_bps').map((p) => ({ mint: p.mint, weight_bps: Number(p.value) }));
}

// ─── Enum normalization ─────────────────────────────────────────────────────────────────────────────

const SOURCES: Record<string, 'xStocks' | 'PreStocks' | 'Tessera'> = {
  xstocks: 'xStocks',
  x_stocks: 'xStocks',
  prestocks: 'PreStocks',
  pre_stocks: 'PreStocks',
  tessera: 'Tessera',
};
const ASSET_TYPES: Record<string, 'public_stock' | 'etf' | 'pre_ipo'> = {
  publicstock: 'public_stock',
  public_stock: 'public_stock',
  etf: 'etf',
  preipo: 'pre_ipo',
  pre_ipo: 'pre_ipo',
};

export function normalizeSource(v: unknown): 'xStocks' | 'PreStocks' | 'Tessera' | null {
  return SOURCES[String(v ?? '').toLowerCase()] ?? null;
}

export function normalizeAssetType(v: unknown): 'public_stock' | 'etf' | 'pre_ipo' | null {
  return ASSET_TYPES[String(v ?? '').toLowerCase()] ?? null;
}
