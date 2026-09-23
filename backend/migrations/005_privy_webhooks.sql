-- Privy webhooks (POST /v1/webhooks/privy): one row per delivery, so a retried delivery is applied
-- once. Payloads are kept for debugging and are pruned by the `privy-webhooks` job after 30 days.
CREATE TABLE privy_webhook_events (
  delivery_id text PRIMARY KEY,
  type        text NOT NULL,
  privy_id    text,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX privy_webhook_events_received_idx ON privy_webhook_events (received_at);

-- Set when Privy reports the account deleted: the row keeps only the public wallet, and every
-- personal detail (email, X handle, Telegram, display name) is cleared.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
