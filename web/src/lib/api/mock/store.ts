/**
 * Mutable state for mock mode. In the browser it persists to localStorage so invest/redeem/publish
 * survive navigation; on the server it is a fresh in-memory copy (public reads only).
 */
import { START_COMMISSION_PAID, START_POSITIONS, START_USDC } from './fixtures';
import type { BucketDetail, PendingEdit } from '../types';

export interface WalletState {
  usdc: number;
  positions: Record<string, { tokens: number; cost: number }>;
  commissionPaid: number;
  email: string | null;
}

export type TxEffect =
  | { kind: 'mint'; wallet: string; slug: string; amount: number; order: string | null; route: 'mint' | 'pool'; tokens: number }
  | { kind: 'redeem'; wallet: string; slug: string; tokens: number; order: string | null; usdcOut: number }
  | { kind: 'create'; wallet: string; bucket: BucketDetail; stake: number; step: number; steps: number }
  | { kind: 'close'; wallet: string; slug: string }
  | { kind: 'edit'; wallet: string; slug: string; pending: PendingEdit }
  | { kind: 'info'; wallet: string; slug: string; name: string; thesis: string };

export interface MockOrder {
  kind: 'mint' | 'redeem';
  wallet: string;
  slug: string;
  createdAt: number;
  legs: { ticker: string; weightPct: number }[];
  /** Index of a leg that fails (slippage demo), or -1. */
  failLeg: number;
  amount: number;
  tokens: number;
  usdcOut: number;
  settled: boolean;
}

export interface MockState {
  v: 1;
  wallets: Record<string, WalletState>;
  created: BucketDetail[];
  closed: string[];
  pendingEdits: Record<string, PendingEdit>;
  info: Record<string, { name: string; thesis: string }>;
  txs: Record<string, TxEffect>;
  orders: Record<string, MockOrder>;
}

const KEY = 'bucket.mock.v1';

function fresh(): MockState {
  return { v: 1, wallets: {}, created: [], closed: [], pendingEdits: {}, info: {}, txs: {}, orders: {} };
}

let memory: MockState | null = null;

export function loadState(): MockState {
  if (typeof window === 'undefined') {
    memory ??= fresh();
    return memory;
  }
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed && parsed.v === 1) {
        parsed.info ??= {};
        memory = parsed;
        return memory;
      }
    }
  } catch {
    /* storage unavailable: fall through to a fresh state */
  }
  memory = fresh();
  return memory;
}

export function saveState(): void {
  if (typeof window === 'undefined' || !memory) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* quota or privacy mode: state stays in memory for this tab */
  }
}

export function resetMockState(): void {
  memory = fresh();
  saveState();
}

export function walletState(s: MockState, wallet: string): WalletState {
  let w = s.wallets[wallet];
  if (!w) {
    w = {
      usdc: START_USDC,
      positions: JSON.parse(JSON.stringify(START_POSITIONS)) as WalletState['positions'],
      commissionPaid: START_COMMISSION_PAID,
      email: null,
    };
    s.wallets[wallet] = w;
  }
  return w;
}
