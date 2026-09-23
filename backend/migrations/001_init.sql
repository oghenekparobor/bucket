-- Bucket backend schema.
--
-- Primary inputs (never truncated by `rebuild`): events, asset_prices (kinds onchain + mark), assets
-- (catalog columns), bucket_slugs, users, link_clicks, backer_attributions, pool_prices, source_health,
-- catalog_audit, alerts, notifications (+ deliveries), job_runs, kv.
-- Derived (rebuilt from events + asset_prices by scripts/rebuild.ts): everything in the "derived" section.
--
-- Units follow docs/architecture.md §1: USD in integer micro-dollars (NUMERIC(38,0)), token amounts in raw
-- base units, prices as micro-dollars per whole raw token.

-- ─── Catalog ────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE assets (
  mint              text PRIMARY KEY,
  ticker            text NOT NULL,
  name              text NOT NULL,
  source            text NOT NULL CHECK (source IN ('xStocks', 'PreStocks', 'Tessera')),
  asset_type        text NOT NULL CHECK (asset_type IN ('public_stock', 'etf', 'pre_ipo')),
  decimals          int  NOT NULL,
  token_program     text,
  logo              text,
  sector            text,
  -- Latest on-chain price. price_e6 is per whole raw token (before the Token-2022 scaled-UI multiplier);
  -- ui_price_e6 is what wallets and issuers display (= price_e6 / ui_multiplier).
  price_e6          numeric(38,0),
  ui_price_e6       numeric(38,0),
  ui_multiplier     numeric(30,12) NOT NULL DEFAULT 1,
  price_updated_at  timestamptz,
  mark_price_e6     numeric(38,0),              -- issuer mark price per UI token (pre-IPO only)
  liquidity_usd     numeric(20,2),
  holders           int,
  -- Jupiter quote probe (see catalog/routingProbe.ts)
  min_trade_usd     numeric(20,6),
  depth_1pct_usd    numeric(20,2),
  probe             jsonb,
  probed_at         timestamptz,
  eligible          boolean NOT NULL DEFAULT false,
  flagged           boolean NOT NULL DEFAULT false,
  flag_reason       text,
  missing_since     timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz,
  source_payload    jsonb,
  -- On-chain allow-list state, projected from AssetAdded / AssetUpdated (reset by rebuild).
  program_listed    boolean NOT NULL DEFAULT false,
  program_enabled   boolean,
  program_flagged   boolean,
  extra_cost_bps    int,
  mirror_of         text,                       -- devnet mock mint → mainnet mint whose prices it mirrors
  fixture           boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_ticker_idx ON assets (lower(ticker));

CREATE TABLE catalog_audit (
  id      bigserial PRIMARY KEY,
  mint    text NOT NULL,
  action  text NOT NULL,          -- flagged | unflagged | added
  reason  text,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_health (
  id          bigserial PRIMARY KEY,
  source      text NOT NULL,      -- jupiter-search | jupiter-price | jupiter-quote | prestocks | tessera
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  ok          boolean NOT NULL,
  status_code int,
  latency_ms  int,
  item_count  int,
  error       text
);
CREATE INDEX source_health_source_idx ON source_health (source, fetched_at DESC);

CREATE TABLE asset_prices (
  mint        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('onchain', 'mark', 'program')),  -- program = PriceUpdated event
  ts          timestamptz NOT NULL,
  price_e6    numeric(38,0) NOT NULL,   -- per whole raw token (onchain/program); per UI token (mark)
  ui_price_e6 numeric(38,0),
  fixture     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (mint, kind, ts)
);

-- ─── Program events (primary input of the indexer) ──────────────────────────────────────────────────────

CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  signature   text NOT NULL,
  slot        bigint NOT NULL,
  event_index int NOT NULL,         -- position among the events emitted by the transaction
  block_time  timestamptz NOT NULL,
  name        text NOT NULL,
  bucket      text,
  data        jsonb NOT NULL,       -- normalized: snake_case keys, u64 as decimal strings, pubkeys base58
  fixture     boolean NOT NULL DEFAULT false,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature, event_index)
);
CREATE INDEX events_order_idx ON events (slot, id);
CREATE INDEX events_bucket_idx ON events (bucket, slot);

CREATE TABLE indexer_state (
  key            text PRIMARY KEY,
  last_signature text,
  last_slot      bigint,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Slugs are assigned once and survive rebuilds.
CREATE TABLE bucket_slugs (
  bucket     text PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Derived: buckets, vaults, orders, positions ────────────────────────────────────────────────────────

CREATE TABLE buckets (
  address          text PRIMARY KEY,
  creator          text NOT NULL,
  bucket_id        bigint NOT NULL,
  token_mint       text NOT NULL,
  name             text NOT NULL,
  thesis           text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  version          int NOT NULL DEFAULT 1,
  hwm_e6           numeric(38,0) NOT NULL DEFAULT 100000000,
  supply           numeric(38,0) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL,
  closed_at        timestamptz,
  last_settled_at  timestamptz,
  last_edit_at     timestamptz,
  creator_funded   boolean NOT NULL DEFAULT false,
  pool_address     text,
  event_count      int NOT NULL DEFAULT 0,
  fixture          boolean NOT NULL DEFAULT false
);
CREATE INDEX buckets_creator_idx ON buckets (creator);

CREATE TABLE bucket_versions (
  bucket        text NOT NULL,
  version       int NOT NULL,
  holdings      jsonb NOT NULL,       -- [{ mint, weight_bps }]
  note          text,
  proposed_at   timestamptz,
  effective_at  timestamptz,
  activated_at  timestamptz,          -- NULL while pending
  PRIMARY KEY (bucket, version)
);

-- Active recipe (latest activated version).
CREATE TABLE holdings (
  bucket     text NOT NULL,
  mint       text NOT NULL,
  weight_bps int NOT NULL,
  position   int NOT NULL,
  PRIMARY KEY (bucket, mint)
);

CREATE TABLE vault_balances (
  bucket     text NOT NULL,
  mint       text NOT NULL,
  balance    numeric(38,0) NOT NULL DEFAULT 0,
  reserved   numeric(38,0) NOT NULL DEFAULT 0,   -- burned-and-owed to open redeem orders
  updated_at timestamptz,
  PRIMARY KEY (bucket, mint)
);

CREATE TABLE vault_balance_log (
  bucket   text NOT NULL,
  mint     text NOT NULL,
  event_id bigint NOT NULL,
  ts       timestamptz NOT NULL,
  balance  numeric(38,0) NOT NULL,
  reserved numeric(38,0) NOT NULL,
  PRIMARY KEY (bucket, mint, event_id)
);
CREATE INDEX vault_balance_log_ts_idx ON vault_balance_log (bucket, ts);

CREATE TABLE supply_log (
  bucket   text NOT NULL,
  event_id bigint NOT NULL,
  ts       timestamptz NOT NULL,
  supply   numeric(38,0) NOT NULL,
  PRIMARY KEY (bucket, event_id)
);
CREATE INDEX supply_log_ts_idx ON supply_log (bucket, ts);

CREATE TABLE commission_settlements (
  bucket               text NOT NULL,
  event_id             bigint NOT NULL,
  ts                   timestamptz NOT NULL,
  vault_value_e6       numeric(38,0) NOT NULL,
  supply_before        numeric(38,0) NOT NULL,
  unit_price_before_e6 numeric(38,0) NOT NULL,
  hwm_before_e6        numeric(38,0) NOT NULL,
  commission_e6        numeric(38,0) NOT NULL,
  creator_tokens       numeric(38,0) NOT NULL,
  platform_tokens      numeric(38,0) NOT NULL,
  hwm_after_e6         numeric(38,0) NOT NULL,
  PRIMARY KEY (bucket, event_id)
);

CREATE TABLE mint_orders (
  address        text PRIMARY KEY,
  bucket         text NOT NULL,
  backer         text NOT NULL,
  amount_e6      numeric(38,0) NOT NULL,
  fee_e6         numeric(38,0) NOT NULL,
  net_e6         numeric(38,0) NOT NULL,
  unit_price_e6  numeric(38,0) NOT NULL,
  tokens_total   numeric(38,0) NOT NULL DEFAULT 0,
  refunded_e6    numeric(38,0),
  status         text NOT NULL CHECK (status IN ('open', 'filling', 'done', 'refunded')),
  opened_at      timestamptz NOT NULL,
  closed_at      timestamptz
);
CREATE INDEX mint_orders_open_idx ON mint_orders (status) WHERE status IN ('open', 'filling');
CREATE INDEX mint_orders_bucket_idx ON mint_orders (bucket, opened_at);

CREATE TABLE mint_order_legs (
  order_address text NOT NULL,
  leg           int NOT NULL,
  mint          text NOT NULL,
  budget_e6     numeric(38,0) NOT NULL,
  spent_e6      numeric(38,0) NOT NULL DEFAULT 0,
  qty           numeric(38,0) NOT NULL DEFAULT 0,
  tokens        numeric(38,0) NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('queued', 'swapping', 'filled', 'failed')),
  attempts      int NOT NULL DEFAULT 0,       -- keeper bookkeeping
  last_error    text,
  filled_at     timestamptz,
  PRIMARY KEY (order_address, leg)
);

CREATE TABLE redeem_orders (
  address        text PRIMARY KEY,
  bucket         text NOT NULL,
  holder         text NOT NULL,
  tokens_burned  numeric(38,0) NOT NULL,
  fee_tokens     numeric(38,0) NOT NULL,
  unit_price_e6  numeric(38,0) NOT NULL,
  usdc_out_e6    numeric(38,0) NOT NULL DEFAULT 0,
  status         text NOT NULL CHECK (status IN ('open', 'filling', 'done')),
  opened_at      timestamptz NOT NULL,
  closed_at      timestamptz
);
CREATE INDEX redeem_orders_open_idx ON redeem_orders (status) WHERE status IN ('open', 'filling');

CREATE TABLE redeem_order_legs (
  order_address text NOT NULL,
  leg           int NOT NULL,
  mint          text NOT NULL,
  qty           numeric(38,0) NOT NULL,
  sold_qty      numeric(38,0) NOT NULL DEFAULT 0,
  usdc_out_e6   numeric(38,0) NOT NULL DEFAULT 0,
  claimed_qty   numeric(38,0) NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('queued', 'swapping', 'filled', 'failed', 'claimed')),
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  PRIMARY KEY (order_address, leg)
);

-- Positions and average-cost basis per wallet per bucket (see perf/costBasis.ts).
CREATE TABLE positions (
  wallet               text NOT NULL,
  bucket               text NOT NULL,
  tokens               numeric(38,0) NOT NULL DEFAULT 0,
  cost_e6              numeric(38,0) NOT NULL DEFAULT 0,   -- cost basis of tokens still held
  realized_e6          numeric(38,0) NOT NULL DEFAULT 0,   -- realized P&L from redeems
  paid_total_e6        numeric(38,0) NOT NULL DEFAULT 0,   -- all USDC paid into mints (incl. fees)
  received_total_e6    numeric(38,0) NOT NULL DEFAULT 0,   -- all USDC (or in-kind value) received from redeems
  commission_paid_e6   numeric(38,0) NOT NULL DEFAULT 0,   -- value diluted away by commission while held
  commission_earned_e6 numeric(38,0) NOT NULL DEFAULT 0,   -- creator: value of commission tokens received
  first_entry_at       timestamptz,
  updated_at           timestamptz,
  PRIMARY KEY (wallet, bucket)
);
CREATE INDEX positions_bucket_idx ON positions (bucket);

CREATE TABLE position_log (
  wallet   text NOT NULL,
  bucket   text NOT NULL,
  event_id bigint NOT NULL,
  ts       timestamptz NOT NULL,
  tokens   numeric(38,0) NOT NULL,
  PRIMARY KEY (wallet, bucket, event_id)
);

-- ─── Derived: performance ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE unit_price_hourly (
  bucket          text NOT NULL,
  hour            timestamptz NOT NULL,
  unit_price_e6   numeric(38,0) NOT NULL,
  vault_value_e6  numeric(38,0) NOT NULL,
  supply          numeric(38,0) NOT NULL,
  hwm_e6          numeric(38,0) NOT NULL,
  holding_values  jsonb NOT NULL,     -- { mint: value_e6 }
  prices          jsonb NOT NULL,     -- { mint: price_e6 }
  PRIMARY KEY (bucket, hour)
);

CREATE TABLE bucket_metrics (
  bucket           text PRIMARY KEY,
  unit_price_e6    numeric(38,0),
  vault_value_e6   numeric(38,0) NOT NULL DEFAULT 0,
  supply           numeric(38,0) NOT NULL DEFAULT 0,
  returns          jsonb NOT NULL,     -- { "7d": pct|null, "30d": ..., "90d": ..., "all": ... }
  max_drawdown     double precision NOT NULL DEFAULT 0,
  contributions    jsonb NOT NULL,     -- { period: { mint: pct } }
  holders          int NOT NULL DEFAULT 0,
  eligible         boolean NOT NULL DEFAULT false,
  ineligible_reasons text[] NOT NULL DEFAULT '{}',
  computed_at      timestamptz NOT NULL
);

CREATE TABLE leaderboard_snapshots (
  id                  bigserial PRIMARY KEY,
  period              text NOT NULL CHECK (period IN ('7d', '30d', '90d', 'all')),
  computed_at         timestamptz NOT NULL,
  enforce_eligibility boolean NOT NULL
);
CREATE INDEX leaderboard_snapshots_idx ON leaderboard_snapshots (period, computed_at DESC);

CREATE TABLE leaderboard_rows (
  snapshot_id bigint NOT NULL REFERENCES leaderboard_snapshots (id) ON DELETE CASCADE,
  rank        int NOT NULL,
  bucket      text NOT NULL,
  ret         double precision,
  eligible    boolean NOT NULL,
  reasons     text[] NOT NULL DEFAULT '{}',
  spark       jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, bucket)
);

-- ─── Users, notifications, attribution, monitoring ──────────────────────────────────────────────────────

CREATE TABLE users (
  id                bigserial PRIMARY KEY,
  privy_id          text UNIQUE,
  wallet            text UNIQUE,
  display_name      text,
  email             text,
  x_handle          text,
  x_verified        boolean NOT NULL DEFAULT false,
  telegram_chat_id  text,
  privy_synced_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  fixture           boolean NOT NULL DEFAULT false
);

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  wallet      text NOT NULL,
  kind        text NOT NULL,          -- edit_proposed | edit_activated
  bucket      text,
  event_id    bigint,
  title       text NOT NULL,
  body        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  UNIQUE (event_id, wallet, kind)
);
CREATE INDEX notifications_wallet_idx ON notifications (wallet, created_at DESC);

CREATE TABLE notification_deliveries (
  id              bigserial PRIMARY KEY,
  notification_id bigint NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel         text NOT NULL CHECK (channel IN ('email', 'telegram')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  sent_at         timestamptz,
  UNIQUE (notification_id, channel)
);
CREATE INDEX notification_deliveries_pending_idx ON notification_deliveries (status) WHERE status = 'pending';

CREATE TABLE link_clicks (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL,
  ref        text,
  ip_hash    text,
  ua_hash    text,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  fixture    boolean NOT NULL DEFAULT false
);
CREATE INDEX link_clicks_slug_idx ON link_clicks (slug, clicked_at);
CREATE INDEX link_clicks_client_idx ON link_clicks (ip_hash, ua_hash, clicked_at);

-- First mint intent per wallet per bucket, and the share-link click it came from (if any).
CREATE TABLE backer_attributions (
  wallet     text NOT NULL,
  bucket     text NOT NULL,
  click_id   bigint REFERENCES link_clicks (id) ON DELETE SET NULL,
  via_link   boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fixture    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (wallet, bucket)
);

CREATE TABLE pool_prices (
  bucket    text NOT NULL,
  ts        timestamptz NOT NULL,
  price_e6  numeric(38,0) NOT NULL,
  source    text NOT NULL,
  fixture   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (bucket, ts)
);

CREATE TABLE alerts (
  id         bigserial PRIMARY KEY,
  level      text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  code       text NOT NULL,
  key        text NOT NULL DEFAULT '',
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}',
  delivered  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_code_idx ON alerts (code, key, created_at DESC);

CREATE TABLE keeper_schedule (
  bucket          text PRIMARY KEY,
  next_settle_at  timestamptz NOT NULL
);

CREATE TABLE job_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  ok          boolean,
  error       text,
  stats       jsonb
);
CREATE INDEX job_runs_job_idx ON job_runs (job, started_at DESC);

CREATE TABLE kv (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
