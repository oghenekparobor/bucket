/**
 * Keeper: fills open mint and redeem orders leg by leg and closes them, settles commission at least
 * daily at a random time per bucket, activates edits once effective, rebalances (phase 2, behind
 * KEEPER_REBALANCE) and watches its own SOL balances. Open orders are read from chain so fills never wait
 * on the indexer; the settle and edit schedules come from the indexed database. Failures raise alerts;
 * a missing key or deployment is logged once, never alerted.
 */
import type { AlertSink } from '../alerts.js';
import { type ChainGateway, ChainUnavailableError, type OpenOrder } from '../chain/gateway.js';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { big } from '../util/money.js';
import { planRebalance } from './rebalancePlan.js';
import { nextSettleAt } from './schedule.js';

export const MAX_LEG_ATTEMPTS = 3;
const SETTLE_RETRY_MS = 10 * 60_000;
/** Trade 1% less than planned: the program bounds trades by the last settled vault value, not live prices. */
const REBALANCE_MARGIN_BPS = 100;

export interface KeeperDeps {
  db: Db;
  gateway: ChainGateway;
  alerts: AlertSink;
  log: Logger;
  cfg: Pick<Config, 'KEEPER_REBALANCE' | 'KEEPER_MIN_SOL' | 'FEE_PAYER_MIN_SOL'>;
  wallets: { keeper: string | null; feePayer: string | null };
  rand?: (n: number) => number;
  slippageBps?: number;
}

export interface TickReport {
  mintLegs: number;
  redeemLegs: number;
  closed: number;
  settled: number;
  activated: number;
  rebalances: number;
  errors: number;
  unavailable: string[];
}

const errMsg = (err: unknown) => (err as Error).message.slice(0, 500);

export class Keeper {
  private readonly unavailableLogged = new Set<string>();
  private readonly attempts = new Map<string, number>();

  constructor(private readonly d: KeeperDeps) {}

  async tick(now = new Date()): Promise<TickReport> {
    const r: TickReport = { mintLegs: 0, redeemLegs: 0, closed: 0, settled: 0, activated: 0, rebalances: 0, errors: 0, unavailable: [] };
    let orders: OpenOrder[] = [];
    try {
      orders = await this.d.gateway.fetchOpenOrders();
    } catch (err) {
      if (!this.unavailable(err, 'fetch_orders', r)) {
        r.errors++;
        await this.d.alerts.raise('warn', 'rpc_error', 'open_orders', 'Could not list open orders', { error: errMsg(err) });
      }
    }
    for (const o of await this.creatorOrdersFirst(orders)) {
      if (o.kind === 'mint') await this.processMint(o, r);
      else await this.processRedeem(o, r);
    }
    await this.settleDue(now, r);
    await this.activateDueEdits(now, r);
    if (this.d.cfg.KEEPER_REBALANCE) await this.rebalance(r);
    return r;
  }

  /** Records a chain operation that cannot run in this deployment; true if `err` was that. */
  private unavailable(err: unknown, what: string, r: TickReport): boolean {
    if (!(err instanceof ChainUnavailableError)) return false;
    if (!r.unavailable.includes(what)) r.unavailable.push(what);
    if (!this.unavailableLogged.has(what)) {
      this.unavailableLogged.add(what);
      this.d.log.warn({ op: what }, err.message);
    }
    return true;
  }

  /** A bucket opens to backers only after the creator's first order fills completely, so those go first. */
  private async creatorOrdersFirst(orders: OpenOrder[]): Promise<OpenOrder[]> {
    if (orders.length < 2) return orders;
    const rows = await this.d.db.query<{ address: string; creator: string }>(
      `SELECT address, creator FROM buckets WHERE address = ANY($1) AND NOT creator_funded`,
      [[...new Set(orders.map((o) => o.bucket))]],
    );
    const unfunded = new Map(rows.rows.map((b) => [b.address, b.creator]));
    const first = (o: OpenOrder) => (o.kind === 'mint' && unfunded.get(o.bucket) === o.owner ? 0 : 1);
    return [...orders].sort((a, b) => first(a) - first(b));
  }

  /** Best-effort leg status for GET /v1/orders (the indexer may not have seen the order yet). */
  private async markLeg(kind: 'mint' | 'redeem', order: string, leg: number, status: string, error: string | null = null): Promise<void> {
    const table = kind === 'mint' ? 'mint_order_legs' : 'redeem_order_legs';
    await this.d.db.query(
      `UPDATE ${table} SET status = $3, last_error = COALESCE($4, last_error), attempts = attempts + CASE WHEN $4 IS NULL THEN 0 ELSE 1 END
       WHERE order_address = $1 AND leg = $2 AND status IN ('queued', 'swapping')`,
      [order, leg, status, error],
    );
  }

  private async processMint(o: OpenOrder, r: TickReport): Promise<void> {
    const pending = o.legs.filter((l) => !l.done);
    let giveUp = o.expired;
    for (const { leg } of giveUp ? [] : pending) {
      const key = `${o.address}:${leg}`;
      if ((this.attempts.get(key) ?? 0) >= MAX_LEG_ATTEMPTS) {
        giveUp = true;
        continue;
      }
      try {
        await this.markLeg('mint', o.address, leg, 'swapping');
        const sig = await this.d.gateway.fillMintLeg(o.address, leg);
        this.attempts.delete(key);
        this.d.log.info({ order: o.address, leg, sig }, 'mint leg filled');
        r.mintLegs++;
      } catch (err) {
        if (this.unavailable(err, 'fill_mint', r)) return;
        r.errors++;
        const attempts = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, attempts);
        await this.markLeg('mint', o.address, leg, 'queued', errMsg(err));
        if (attempts >= MAX_LEG_ATTEMPTS) {
          giveUp = true;
          await this.d.alerts.raise('error', 'fill_failed', key, `Mint leg failed ${attempts} times; refunding the rest of the order`, {
            order: o.address,
            leg,
            bucket: o.bucket,
            error: errMsg(err),
          });
        }
      }
    }
    const stillPending = pending.filter((l) => (this.attempts.get(`${o.address}:${l.leg}`) ?? 0) > 0).length;
    if (giveUp || stillPending === 0) await this.close('mint', o, r);
  }

  private async processRedeem(o: OpenOrder, r: TickReport): Promise<void> {
    let failed = 0;
    for (const { leg } of o.legs.filter((l) => !l.done)) {
      const key = `${o.address}:${leg}`;
      if ((this.attempts.get(key) ?? 0) >= MAX_LEG_ATTEMPTS) {
        failed++;
        continue;
      }
      try {
        await this.markLeg('redeem', o.address, leg, 'swapping');
        await this.d.gateway.fillRedeemLeg(o.address, leg);
        this.attempts.delete(key);
        r.redeemLegs++;
      } catch (err) {
        if (this.unavailable(err, 'fill_redeem', r)) return;
        r.errors++;
        failed++;
        const attempts = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, attempts);
        await this.markLeg('redeem', o.address, leg, attempts >= MAX_LEG_ATTEMPTS ? 'failed' : 'queued', errMsg(err));
        if (attempts >= MAX_LEG_ATTEMPTS) {
          await this.d.alerts.raise('error', 'redeem_fill_failed', key, 'Redeem leg failed; the holder can claim it in kind', {
            order: o.address,
            leg,
            bucket: o.bucket,
            error: errMsg(err),
          });
        }
      }
    }
    // A redeem order closes once every leg is sold or claimed; failed legs wait for the holder's claim.
    if (failed === 0) await this.close('redeem', o, r);
  }

  private async close(kind: 'mint' | 'redeem', o: OpenOrder, r: TickReport): Promise<void> {
    try {
      await (kind === 'mint' ? this.d.gateway.closeMintOrder(o.address) : this.d.gateway.closeRedeemOrder(o.address));
      for (const l of o.legs) this.attempts.delete(`${o.address}:${l.leg}`);
      r.closed++;
    } catch (err) {
      if (this.unavailable(err, `close_${kind}_order`, r)) return;
      r.errors++;
      await this.d.alerts.raise('error', 'close_failed', o.address, `Could not close ${kind} order`, { order: o.address, error: errMsg(err) });
    }
  }

  private async settleDue(now: Date, r: TickReport): Promise<void> {
    const nowMs = now.getTime();
    const buckets = await this.d.db.query(
      `SELECT b.address, COALESCE(b.last_settled_at, b.created_at) AS last, s.next_settle_at
       FROM buckets b LEFT JOIN keeper_schedule s ON s.bucket = b.address WHERE b.supply > 0 AND NOT b.fixture`,
    );
    for (const b of buckets.rows) {
      let next: number = b.next_settle_at ? (b.next_settle_at as Date).getTime() : nextSettleAt((b.last as Date).getTime(), nowMs, this.d.rand);
      if (!b.next_settle_at) await this.setNextSettle(b.address, next);
      if (next > nowMs) continue;
      try {
        await this.d.gateway.settle(b.address);
        r.settled++;
        next = nextSettleAt(nowMs, nowMs, this.d.rand);
      } catch (err) {
        if (this.unavailable(err, 'settle_commission', r)) return;
        r.errors++;
        next = nowMs + SETTLE_RETRY_MS;
        await this.d.alerts.raise('error', 'settle_failed', b.address, 'settle_commission failed', { bucket: b.address, error: errMsg(err) });
      }
      await this.setNextSettle(b.address, next);
    }
  }

  private async setNextSettle(bucket: string, atMs: number): Promise<void> {
    await this.d.db.query(
      `INSERT INTO keeper_schedule (bucket, next_settle_at) VALUES ($1, $2)
       ON CONFLICT (bucket) DO UPDATE SET next_settle_at = EXCLUDED.next_settle_at`,
      [bucket, new Date(atMs)],
    );
  }

  private async activateDueEdits(now: Date, r: TickReport): Promise<void> {
    const due = await this.d.db.query(
      `SELECT v.bucket, v.version FROM bucket_versions v JOIN buckets b ON b.address = v.bucket
       WHERE v.activated_at IS NULL AND v.effective_at <= $1 AND v.version > b.version AND NOT b.fixture`,
      [now],
    );
    for (const e of due.rows) {
      try {
        await this.d.gateway.activateEdit(e.bucket);
        r.activated++;
      } catch (err) {
        if (this.unavailable(err, 'activate_edit', r)) return;
        r.errors++;
        await this.d.alerts.raise('error', 'activate_failed', `${e.bucket}:${e.version}`, 'activate_edit failed', { bucket: e.bucket, error: errMsg(err) });
      }
    }
  }

  /** Phase 2: trade each bucket toward its active weights, alerting when a trade cannot complete in bounds. */
  private async rebalance(r: TickReport): Promise<void> {
    const rows = await this.d.db.query(
      `SELECT v.bucket, v.mint, v.balance - v.reserved AS available, COALESCE(h.weight_bps, 0) AS weight_bps, a.decimals,
         (SELECT p.price_e6 FROM asset_prices p WHERE p.mint = v.mint AND p.kind IN ('onchain', 'program') ORDER BY p.ts DESC LIMIT 1) AS price_e6
       FROM vault_balances v JOIN buckets b ON b.address = v.bucket AND b.status = 'open' AND NOT b.fixture
       JOIN assets a ON a.mint = v.mint
       LEFT JOIN holdings h ON h.bucket = v.bucket AND h.mint = v.mint`,
    );
    const byBucket = new Map<string, typeof rows.rows>();
    for (const row of rows.rows) byBucket.set(row.bucket, [...(byBucket.get(row.bucket) ?? []), row]);
    for (const [bucket, holdings] of byBucket) {
      if (holdings.some((h) => h.price_e6 === null)) continue;
      const trades = planRebalance(
        holdings.map((h) => ({ mint: h.mint, available: big(h.available), priceE6: big(h.price_e6), decimals: h.decimals, weightBps: Number(h.weight_bps) })),
        this.d.slippageBps ?? 100,
        50,
        REBALANCE_MARGIN_BPS,
      );
      for (const t of trades) {
        try {
          await this.d.gateway.rebalance({ bucket, fromMint: t.fromMint, toMint: t.toMint, qtyIn: t.qtyIn });
          r.rebalances++;
        } catch (err) {
          if (this.unavailable(err, 'rebalance', r)) return;
          r.errors++;
          await this.d.alerts.raise('error', 'rebalance_failed', `${bucket}:${t.fromMint}:${t.toMint}`, 'Rebalance trade could not complete within bounds', {
            bucket,
            from: t.fromMint,
            to: t.toMint,
            error: errMsg(err),
          });
        }
      }
    }
  }

  /** Warns when the keeper or fee-payer wallet runs low on SOL. */
  async checkBalances(): Promise<{ wallet: string; sol: number }[]> {
    const out: { wallet: string; sol: number }[] = [];
    const checks: [string | null, number, string][] = [
      [this.d.wallets.keeper, this.d.cfg.KEEPER_MIN_SOL, 'keeper'],
      [this.d.wallets.feePayer, this.d.cfg.FEE_PAYER_MIN_SOL, 'fee_payer'],
    ];
    for (const [wallet, min, role] of checks) {
      if (!wallet) continue;
      try {
        const { solLamports } = await this.d.gateway.getWalletBalances(wallet);
        const sol = Number(solLamports) / 1e9;
        out.push({ wallet, sol });
        if (sol < min) {
          await this.d.alerts.raise('warn', 'low_balance', wallet, `${role} wallet has ${sol.toFixed(3)} SOL (minimum ${min})`, { role, wallet, sol });
        }
      } catch (err) {
        await this.d.alerts.raise('warn', 'rpc_error', `balance:${wallet}`, `Could not read ${role} balance`, { error: errMsg(err) });
      }
    }
    return out;
  }
}
