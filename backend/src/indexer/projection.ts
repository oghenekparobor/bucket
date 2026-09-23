/**
 * Event projection: applies one stored program event to the derived tables. Called by live ingestion,
 * the fixture seed and `rebuild`, always in chain order (slot, then insertion order), inside the
 * caller's transaction. Every handler depends only on the event and on state built by earlier events,
 * so replaying `events` from scratch reproduces the same database.
 */
import type { Queryable } from '../db/pool.js';
import { notifyHolders } from '../notify/inApp.js';
import {
  applyCommissionTokens,
  applyMintFill,
  applyMintRefund,
  applyRedeem,
  applyRedeemProceeds,
  emptyPosition,
  legCostE6,
  type PositionState,
} from '../perf/costBasis.js';
import { E6, big, valueE6 } from '../util/money.js';
import { uniqueSlug } from '../util/slug.js';
import {
  bool,
  eventTimeMs,
  holdingsOf,
  int,
  normalizeAssetType,
  normalizeSource,
  optStr,
  optU64,
  pairs,
  type StoredEvent,
  str,
  u64,
} from './events.js';

export interface ProjectionContext {
  /** Wallet that receives platform commission and fee tokens (Config.fee_wallet). */
  platformWallet: string;
  /** Wall-clock now; notifications for events older than 48h are recorded in-app but not emailed. */
  nowMs: number;
}

const DELIVERY_WINDOW_MS = 48 * 3_600_000;

export async function applyEvent(c: Queryable, ev: StoredEvent, ctx: ProjectionContext): Promise<void> {
  const d = ev.data;
  const at = new Date(eventTimeMs(ev));
  const p = new Projector(c, ev, at, ctx);

  switch (ev.name) {
    case 'ConfigUpdated':
      await c.query(
        `INSERT INTO kv (key, value, updated_at) VALUES ('program_config', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(d), at],
      );
      break;

    case 'AssetAdded':
      await p.assetAdded();
      break;

    case 'AssetUpdated':
      await c.query(
        `UPDATE assets SET program_enabled = COALESCE($2, program_enabled), program_flagged = COALESCE($3, program_flagged),
           extra_cost_bps = COALESCE($4, extra_cost_bps), updated_at = now() WHERE mint = $1`,
        [str(d, 'mint'), bool(d, 'enabled'), bool(d, 'flagged'), d.extra_cost_bps ?? null],
      );
      break;

    case 'PriceUpdated':
      await c.query(
        `INSERT INTO asset_prices (mint, kind, ts, price_e6, fixture) VALUES ($1, 'program', $2, $3, $4)
         ON CONFLICT (mint, kind, ts) DO UPDATE SET price_e6 = EXCLUDED.price_e6`,
        [str(d, 'mint'), at, u64(d, 'price_e6').toString(), ev.fixture ?? false],
      );
      break;

    case 'BucketCreated':
      await p.bucketCreated();
      break;
    case 'MintOpened':
      await p.mintOpened();
      break;
    case 'MintFilled':
      await p.mintFilled();
      break;
    case 'MintClosed':
      await p.mintClosed();
      break;
    case 'Redeemed':
      await p.redeemed();
      break;
    case 'RedeemFilled':
      await p.redeemFilled();
      break;
    case 'RedeemClaimed':
      await p.redeemClaimed();
      break;
    case 'RedeemClosed':
      await c.query(`UPDATE redeem_orders SET status = 'done', closed_at = $2 WHERE address = $1`, [str(d, 'order'), at]);
      break;
    case 'CommissionSettled':
      await p.commissionSettled();
      break;
    case 'BucketInfoUpdated':
      // Name and thesis are editable; the slug, recipe and performance history are not.
      await c.query(`UPDATE buckets SET name = $2, thesis = $3 WHERE address = $1`, [str(d, 'bucket'), str(d, 'name'), optStr(d, 'thesis') ?? '']);
      break;
    case 'FeesClaimed':
      // Commission tokens are credited to the creator / platform position when settled; claiming only
      // moves them from the fee account to the wallet, so positions do not change.
      break;
    case 'BucketClosed':
      await c.query(`UPDATE buckets SET status = 'closed', closed_at = $2 WHERE address = $1`, [str(d, 'bucket'), at]);
      break;
    case 'EditProposed':
      await p.editProposed();
      break;
    case 'EditActivated':
      await p.editActivated();
      break;
    case 'Rebalanced':
      await p.setVault(str(d, 'bucket'), str(d, 'from_mint'), u64(d, 'from_balance'), 0n);
      await p.setVault(str(d, 'bucket'), str(d, 'to_mint'), u64(d, 'to_balance'), 0n);
      break;
  }

  const bucket = optStr(d, 'bucket');
  if (bucket) await c.query('UPDATE buckets SET event_count = event_count + 1 WHERE address = $1', [bucket]);
}

class Projector {
  constructor(
    private readonly c: Queryable,
    private readonly ev: StoredEvent,
    private readonly at: Date,
    private readonly ctx: ProjectionContext,
  ) {}

  private get d() {
    return this.ev.data;
  }

  // ── vault / supply / positions ──

  /** Sets a vault balance (null = unchanged) and shifts the reserved quantity; logs the result. */
  async setVault(bucket: string, mint: string, balance: bigint | null, reservedDelta: bigint): Promise<void> {
    const res = await this.c.query<{ balance: string; reserved: string }>(
      `INSERT INTO vault_balances (bucket, mint, balance, reserved, updated_at)
       VALUES ($1, $2, COALESCE($3::numeric, 0), GREATEST($4::numeric, 0), $5)
       ON CONFLICT (bucket, mint) DO UPDATE SET
         balance = COALESCE($3::numeric, vault_balances.balance),
         reserved = GREATEST(vault_balances.reserved + $4::numeric, 0),
         updated_at = $5
       RETURNING balance, reserved`,
      [bucket, mint, balance?.toString() ?? null, reservedDelta.toString(), this.at],
    );
    const row = res.rows[0]!;
    await this.c.query(
      `INSERT INTO vault_balance_log (bucket, mint, event_id, ts, balance, reserved) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (bucket, mint, event_id) DO UPDATE SET balance = EXCLUDED.balance, reserved = EXCLUDED.reserved`,
      [bucket, mint, this.ev.id, this.at, row.balance, row.reserved],
    );
  }

  async setSupply(bucket: string, supply: bigint): Promise<void> {
    await this.c.query('UPDATE buckets SET supply = $2 WHERE address = $1', [bucket, supply.toString()]);
    await this.c.query(
      `INSERT INTO supply_log (bucket, event_id, ts, supply) VALUES ($1, $2, $3, $4)
       ON CONFLICT (bucket, event_id) DO UPDATE SET supply = EXCLUDED.supply`,
      [bucket, this.ev.id, this.at, supply.toString()],
    );
  }

  async loadPosition(wallet: string, bucket: string): Promise<PositionState> {
    const r = await this.c.query(
      `SELECT tokens, cost_e6, realized_e6, paid_total_e6, received_total_e6, commission_paid_e6, commission_earned_e6
       FROM positions WHERE wallet = $1 AND bucket = $2 FOR UPDATE`,
      [wallet, bucket],
    );
    const row = r.rows[0];
    if (!row) return emptyPosition();
    return {
      tokens: big(row.tokens),
      costE6: big(row.cost_e6),
      realizedE6: big(row.realized_e6),
      paidTotalE6: big(row.paid_total_e6),
      receivedTotalE6: big(row.received_total_e6),
      commissionPaidE6: big(row.commission_paid_e6),
      commissionEarnedE6: big(row.commission_earned_e6),
    };
  }

  async savePosition(wallet: string, bucket: string, p: PositionState, entered = false): Promise<void> {
    await this.c.query(
      `INSERT INTO positions (wallet, bucket, tokens, cost_e6, realized_e6, paid_total_e6, received_total_e6,
         commission_paid_e6, commission_earned_e6, first_entry_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10 THEN $11::timestamptz END, $11)
       ON CONFLICT (wallet, bucket) DO UPDATE SET
         tokens = EXCLUDED.tokens, cost_e6 = EXCLUDED.cost_e6, realized_e6 = EXCLUDED.realized_e6,
         paid_total_e6 = EXCLUDED.paid_total_e6, received_total_e6 = EXCLUDED.received_total_e6,
         commission_paid_e6 = EXCLUDED.commission_paid_e6, commission_earned_e6 = EXCLUDED.commission_earned_e6,
         first_entry_at = COALESCE(positions.first_entry_at, EXCLUDED.first_entry_at), updated_at = EXCLUDED.updated_at`,
      [
        wallet,
        bucket,
        p.tokens.toString(),
        p.costE6.toString(),
        p.realizedE6.toString(),
        p.paidTotalE6.toString(),
        p.receivedTotalE6.toString(),
        p.commissionPaidE6.toString(),
        p.commissionEarnedE6.toString(),
        entered,
        this.at,
      ],
    );
    await this.c.query(
      `INSERT INTO position_log (wallet, bucket, event_id, ts, tokens) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (wallet, bucket, event_id) DO UPDATE SET tokens = EXCLUDED.tokens`,
      [wallet, bucket, this.ev.id, this.at, p.tokens.toString()],
    );
  }

  async addTokens(wallet: string, bucket: string, tokens: bigint, earnedE6: bigint): Promise<void> {
    if (tokens <= 0n) return;
    const pos = await this.loadPosition(wallet, bucket);
    await this.savePosition(wallet, bucket, applyCommissionTokens(pos, tokens, earnedE6), true);
  }

  /** Latest on-chain price of a mint at the event time, as value of `qty` raw units. */
  async valueAt(mint: string, qty: bigint): Promise<bigint> {
    const r = await this.c.query<{ price_e6: string; decimals: number }>(
      `SELECT p.price_e6, a.decimals FROM asset_prices p JOIN assets a ON a.mint = p.mint
       WHERE p.mint = $1 AND p.kind IN ('onchain', 'program') AND p.ts <= $2 ORDER BY p.ts DESC LIMIT 1`,
      [mint, this.at],
    );
    const row = r.rows[0];
    return row ? valueE6(qty, big(row.price_e6), row.decimals) : 0n;
  }

  // ── handlers ──

  async assetAdded(): Promise<void> {
    const d = this.d;
    const mint = str(d, 'mint');
    const symbol = optStr(d, 'symbol') ?? mint.slice(0, 6);
    await this.c.query(
      `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, token_program, program_listed,
         program_enabled, program_flagged, extra_cost_bps, mirror_of, fixture)
       VALUES ($1, $2, $2, $3, $4, $5, $6, true, true, false, $7,
         (SELECT m.mint FROM assets m WHERE m.ticker = $2 AND m.mint <> $1 AND NOT m.program_listed AND NOT m.fixture LIMIT 1), $8)
       ON CONFLICT (mint) DO UPDATE SET program_listed = true, program_enabled = true, program_flagged = false,
         extra_cost_bps = EXCLUDED.extra_cost_bps, updated_at = now()`,
      [
        mint,
        symbol,
        normalizeSource(d.source) ?? 'xStocks',
        normalizeAssetType(d.asset_type) ?? 'public_stock',
        d.decimals === undefined ? 6 : int(d, 'decimals'),
        optStr(d, 'token_program'),
        d.extra_cost_bps === undefined ? 0 : int(d, 'extra_cost_bps'),
        this.ev.fixture ?? false,
      ],
    );
    const price = optU64(d, 'price_e6');
    if (price !== null && price > 0n) {
      await this.c.query(
        `INSERT INTO asset_prices (mint, kind, ts, price_e6, fixture) VALUES ($1, 'program', $2, $3, $4)
         ON CONFLICT (mint, kind, ts) DO NOTHING`,
        [mint, this.at, price.toString(), this.ev.fixture ?? false],
      );
    }
  }

  async bucketCreated(): Promise<void> {
    const d = this.d;
    const bucket = str(d, 'bucket');
    const name = str(d, 'name');
    const holdings = holdingsOf(d);
    await this.c.query(
      `INSERT INTO buckets (address, creator, bucket_id, token_mint, name, thesis, created_at, fixture)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (address) DO NOTHING`,
      [bucket, str(d, 'creator'), u64(d, 'id').toString(), str(d, 'token_mint'), name, optStr(d, 'thesis') ?? '', this.at, this.ev.fixture ?? false],
    );
    await this.c.query(
      `INSERT INTO bucket_versions (bucket, version, holdings, proposed_at, effective_at, activated_at)
       VALUES ($1, 1, $2, $3, $3, $3) ON CONFLICT (bucket, version) DO NOTHING`,
      [bucket, JSON.stringify(holdings), this.at],
    );
    await this.replaceHoldings(bucket, holdings);
    const existing = await this.c.query('SELECT 1 FROM bucket_slugs WHERE bucket = $1', [bucket]);
    if (existing.rowCount === 0) {
      const slug = await uniqueSlug(name, async (s) => ((await this.c.query('SELECT 1 FROM bucket_slugs WHERE slug = $1', [s])).rowCount ?? 0) > 0);
      await this.c.query('INSERT INTO bucket_slugs (bucket, slug) VALUES ($1, $2)', [bucket, slug]);
    }
  }

  private async replaceHoldings(bucket: string, holdings: { mint: string; weight_bps: number }[]): Promise<void> {
    await this.c.query('DELETE FROM holdings WHERE bucket = $1', [bucket]);
    for (const [i, h] of holdings.entries()) {
      await this.c.query('INSERT INTO holdings (bucket, mint, weight_bps, position) VALUES ($1, $2, $3, $4)', [bucket, h.mint, h.weight_bps, i]);
      await this.c.query(
        `INSERT INTO vault_balances (bucket, mint, balance, reserved) VALUES ($1, $2, 0, 0) ON CONFLICT (bucket, mint) DO NOTHING`,
        [bucket, h.mint],
      );
    }
  }

  async mintOpened(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const bucket = str(d, 'bucket');
    await this.c.query(
      `INSERT INTO mint_orders (address, bucket, backer, amount_e6, fee_e6, net_e6, rent_fee_e6, unit_price_e6, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9) ON CONFLICT (address) DO NOTHING`,
      [
        order,
        bucket,
        str(d, 'backer'),
        u64(d, 'amount_e6').toString(),
        u64(d, 'fee_e6').toString(),
        u64(d, 'net_e6').toString(),
        (optU64(d, 'rent_fee_e6') ?? 0n).toString(),
        u64(d, 'unit_price_e6').toString(),
        this.at,
      ],
    );
    for (const [i, leg] of pairs(d, 'legs', 'amount').entries()) {
      await this.c.query(
        `INSERT INTO mint_order_legs (order_address, leg, mint, budget_e6, status) VALUES ($1, $2, $3, $4, 'queued')
         ON CONFLICT (order_address, leg) DO NOTHING`,
        [order, i, leg.mint, leg.value.toString()],
      );
    }
    await this.c.query(
      `INSERT INTO backer_attributions (wallet, bucket, via_link, created_at, fixture) VALUES ($1, $2, false, $3, $4)
       ON CONFLICT (wallet, bucket) DO NOTHING`,
      [str(d, 'backer'), bucket, this.at, this.ev.fixture ?? false],
    );
  }

  async mintFilled(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const bucket = str(d, 'bucket');
    const backer = str(d, 'backer');
    const spent = u64(d, 'usdc_spent');
    const tokens = u64(d, 'tokens');
    await this.c.query(
      `UPDATE mint_order_legs SET spent_e6 = spent_e6 + $3, qty = qty + $4, tokens = tokens + $5, status = 'filled', filled_at = $6
       WHERE order_address = $1 AND leg = $2`,
      [order, int(d, 'leg'), spent.toString(), u64(d, 'qty').toString(), tokens.toString(), this.at],
    );
    const o = await this.c.query<{ amount_e6: string; net_e6: string; rent_fee_e6: string }>(
      `UPDATE mint_orders SET tokens_total = tokens_total + $2, status = CASE WHEN status = 'open' THEN 'filling' ELSE status END
       WHERE address = $1 RETURNING amount_e6, net_e6, rent_fee_e6`,
      [order, tokens.toString()],
    );
    await this.setVault(bucket, str(d, 'mint'), u64(d, 'vault_balance'), 0n);
    await this.setSupply(bucket, u64(d, 'supply'));
    const row = o.rows[0];
    // The backer paid amount (fee + net) plus any rent fee; each leg carries its share of both fees.
    const cost = row ? legCostE6(spent, big(row.amount_e6) + big(row.rent_fee_e6), big(row.net_e6)) : spent;
    const pos = await this.loadPosition(backer, bucket);
    await this.savePosition(backer, bucket, applyMintFill(pos, { tokens, costE6: cost }), true);
    // The bucket opens to other backers once one creator mint order has filled completely (every leg).
    await this.c.query(
      `UPDATE buckets SET creator_funded = true WHERE address = $1 AND creator = $2 AND NOT creator_funded
         AND NOT EXISTS (SELECT 1 FROM mint_order_legs WHERE order_address = $3 AND status <> 'filled')`,
      [bucket, backer, order],
    );
  }

  async mintClosed(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const refunded = u64(d, 'refunded_e6');
    const unfilled = await this.c.query(
      `UPDATE mint_order_legs SET status = 'failed' WHERE order_address = $1 AND status IN ('queued', 'swapping')`,
      [order],
    );
    const o = await this.c.query<{ fee_e6: string; rent_fee_e6: string; net_e6: string }>(
      `UPDATE mint_orders SET refunded_e6 = $2, closed_at = $3, status = $4 WHERE address = $1 RETURNING fee_e6, rent_fee_e6, net_e6`,
      [order, refunded.toString(), this.at, (unfilled.rowCount ?? 0) > 0 ? 'refunded' : 'done'],
    );
    const row = o.rows[0];
    if (row && refunded > 0n) {
      const wallet = str(d, 'backer');
      const bucket = str(d, 'bucket');
      const pos = await this.loadPosition(wallet, bucket);
      const fees = big(row.fee_e6) + big(row.rent_fee_e6);
      await this.savePosition(wallet, bucket, applyMintRefund(pos, { refundedE6: refunded, feeE6: fees, netE6: big(row.net_e6) }));
    }
  }

  async redeemed(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const bucket = str(d, 'bucket');
    const holder = str(d, 'holder');
    const burned = u64(d, 'tokens_burned');
    const feeTokens = optU64(d, 'fee_tokens') ?? 0n;
    await this.c.query(
      `INSERT INTO redeem_orders (address, bucket, holder, tokens_burned, fee_tokens, unit_price_e6, status, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7) ON CONFLICT (address) DO NOTHING`,
      [order, bucket, holder, burned.toString(), feeTokens.toString(), u64(d, 'unit_price_e6').toString(), this.at],
    );
    for (const [i, leg] of pairs(d, 'legs', 'amount').entries()) {
      await this.c.query(
        `INSERT INTO redeem_order_legs (order_address, leg, mint, qty, status) VALUES ($1, $2, $3, $4, 'queued')
         ON CONFLICT (order_address, leg) DO NOTHING`,
        [order, i, leg.mint, leg.value.toString()],
      );
      await this.setVault(bucket, leg.mint, null, leg.value);
    }
    await this.setSupply(bucket, u64(d, 'supply'));
    // The holder gives up the burned tokens plus any fee tokens (which go to the platform wallet).
    const pos = await this.loadPosition(holder, bucket);
    await this.savePosition(holder, bucket, applyRedeem(pos, burned + feeTokens).position);
    await this.addTokens(this.ctx.platformWallet, bucket, feeTokens, 0n);
  }

  private async refreshRedeemStatus(order: string): Promise<void> {
    await this.c.query(
      `UPDATE redeem_orders SET status = CASE
         WHEN NOT EXISTS (SELECT 1 FROM redeem_order_legs WHERE order_address = $1 AND status IN ('queued', 'swapping')) THEN 'done'
         ELSE 'filling' END
       WHERE address = $1 AND status <> 'done'`,
      [order],
    );
  }

  async redeemFilled(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const bucket = str(d, 'bucket');
    const sold = u64(d, 'qty_sold');
    const usdcOut = u64(d, 'usdc_out');
    await this.c.query(
      `UPDATE redeem_order_legs SET sold_qty = sold_qty + $3, usdc_out_e6 = usdc_out_e6 + $4,
         status = CASE WHEN sold_qty + $3 + claimed_qty >= qty THEN 'filled' ELSE status END
       WHERE order_address = $1 AND leg = $2`,
      [order, int(d, 'leg'), sold.toString(), usdcOut.toString()],
    );
    await this.c.query('UPDATE redeem_orders SET usdc_out_e6 = usdc_out_e6 + $2 WHERE address = $1', [order, usdcOut.toString()]);
    await this.refreshRedeemStatus(order);
    await this.setVault(bucket, str(d, 'mint'), u64(d, 'vault_balance'), -sold);
    const holder = str(d, 'holder');
    const pos = await this.loadPosition(holder, bucket);
    await this.savePosition(holder, bucket, applyRedeemProceeds(pos, usdcOut));
  }

  async redeemClaimed(): Promise<void> {
    const d = this.d;
    const order = str(d, 'order');
    const bucket = str(d, 'bucket');
    const mint = str(d, 'mint');
    const qty = u64(d, 'qty');
    await this.c.query(
      `UPDATE redeem_order_legs SET claimed_qty = claimed_qty + $3, status = 'claimed' WHERE order_address = $1 AND leg = $2`,
      [order, int(d, 'leg'), qty.toString()],
    );
    await this.refreshRedeemStatus(order);
    await this.setVault(bucket, mint, u64(d, 'vault_balance'), -qty);
    const holder = str(d, 'holder');
    const pos = await this.loadPosition(holder, bucket);
    await this.savePosition(holder, bucket, applyRedeemProceeds(pos, await this.valueAt(mint, qty)));
  }

  async commissionSettled(): Promise<void> {
    const d = this.d;
    const bucket = str(d, 'bucket');
    const vault = u64(d, 'vault_value_e6');
    const supplyBefore = u64(d, 'supply_before');
    const unitBefore = u64(d, 'unit_price_before_e6');
    const creatorTokens = u64(d, 'creator_tokens');
    const platformTokens = u64(d, 'platform_tokens');
    const supplyAfter = supplyBefore + creatorTokens + platformTokens;
    const unitAfter = supplyAfter > 0n ? (vault * E6) / supplyAfter : unitBefore;
    await this.c.query(
      `INSERT INTO commission_settlements (bucket, event_id, ts, vault_value_e6, supply_before, unit_price_before_e6,
         hwm_before_e6, commission_e6, creator_tokens, platform_tokens, hwm_after_e6)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (bucket, event_id) DO NOTHING`,
      [
        bucket,
        this.ev.id,
        this.at,
        vault.toString(),
        supplyBefore.toString(),
        unitBefore.toString(),
        u64(d, 'hwm_before_e6').toString(),
        u64(d, 'commission_e6').toString(),
        creatorTokens.toString(),
        platformTokens.toString(),
        u64(d, 'hwm_after_e6').toString(),
      ],
    );
    // Every existing holder is diluted equally (spec rule 5); record the value each gave up.
    await this.c.query(
      `UPDATE positions SET commission_paid_e6 = commission_paid_e6 + trunc(tokens * $2::numeric / 1000000)
       WHERE bucket = $1 AND tokens > 0`,
      [bucket, (unitBefore > unitAfter ? unitBefore - unitAfter : 0n).toString()],
    );
    const b = await this.c.query<{ creator: string }>(
      `UPDATE buckets SET hwm_e6 = $2, last_settled_at = $3 WHERE address = $1 RETURNING creator`,
      [bucket, u64(d, 'hwm_after_e6').toString(), this.at],
    );
    await this.setSupply(bucket, supplyAfter);
    const creator = b.rows[0]?.creator;
    if (creator) await this.addTokens(creator, bucket, creatorTokens, (creatorTokens * unitAfter) / E6);
    await this.addTokens(this.ctx.platformWallet, bucket, platformTokens, 0n);
  }

  async editProposed(): Promise<void> {
    const d = this.d;
    const bucket = str(d, 'bucket');
    const version = int(d, 'version');
    const holdings = holdingsOf(d);
    const effectiveAt = new Date(Number(u64(d, 'effective_at')) * 1000);
    const note = optStr(d, 'note');
    await this.c.query(
      `INSERT INTO bucket_versions (bucket, version, holdings, note, proposed_at, effective_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (bucket, version) DO UPDATE SET holdings = EXCLUDED.holdings, note = EXCLUDED.note,
         proposed_at = EXCLUDED.proposed_at, effective_at = EXCLUDED.effective_at`,
      [bucket, version, JSON.stringify(holdings), note, this.at, effectiveAt],
    );
    await this.c.query('UPDATE buckets SET last_edit_at = $2 WHERE address = $1', [bucket, this.at]);
    await notifyHolders(this.c, {
      eventId: this.ev.id,
      bucket,
      kind: 'edit_proposed',
      version,
      holdings,
      note,
      effectiveAt,
      at: this.at,
      platformWallet: this.ctx.platformWallet,
      deliver: this.ctx.nowMs - this.at.getTime() < DELIVERY_WINDOW_MS,
    });
  }

  async editActivated(): Promise<void> {
    const d = this.d;
    const bucket = str(d, 'bucket');
    const version = int(d, 'version');
    const holdings = holdingsOf(d);
    await this.c.query(
      `INSERT INTO bucket_versions (bucket, version, holdings, effective_at, activated_at) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (bucket, version) DO UPDATE SET holdings = EXCLUDED.holdings, activated_at = EXCLUDED.activated_at`,
      [bucket, version, JSON.stringify(holdings), this.at],
    );
    await this.c.query('UPDATE buckets SET version = $2 WHERE address = $1', [bucket, version]);
    await this.replaceHoldings(bucket, holdings);
    await notifyHolders(this.c, {
      eventId: this.ev.id,
      bucket,
      kind: 'edit_activated',
      version,
      holdings,
      note: null,
      effectiveAt: this.at,
      at: this.at,
      platformWallet: this.ctx.platformWallet,
      deliver: this.ctx.nowMs - this.at.getTime() < DELIVERY_WINDOW_MS,
    });
  }
}
