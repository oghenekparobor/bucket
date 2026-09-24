# Runbooks

Checklist 2.5: *Runbooks: keeper outage, Privy outage, token delisting, stuck mint, suspected manipulation, program pause decision.*

Every runbook starts the same way: open an incident in the support channel, post a status-page notice if users are affected, and name one owner. What users can always do (the program guarantees it): **redeem, and take their slice in kind**, with nothing but their wallet key. See `vault/scripts/cli.ts`.

---

## 1. Keeper outage

**Signal:** alert `keeper.heartbeat_missed`, or open mint orders older than 2 minutes, or `fill_mint` / `fill_redeem` / `settle_commission` failure rate > 20% for 10 minutes.

**Impact:** mints stop filling (USDC waits in the escrow), redeems wait to be sold, and commission is not settled. **No funds are at risk**, and orders expire after 10 minutes (`order_ttl_secs`).

1. Check the keeper process, its SOL balance (`keys/keeper.json` role), and RPC health.
2. Fail over to the standby keeper. Both keepers use the same keeper key, and only one may run at a time (the lease in Postgres).
3. If the keeper key is lost or compromised: the admin runs `set_roles` with a new keeper key. The keeper cannot move funds, so this is not an emergency for user money.
4. After recovery, the keeper closes expired mint orders (`close_mint_order` refunds USDC) and resumes fills.
5. Users meanwhile: backers can fill their own mint legs or cancel them (`close_mint_order` as backer). Holders can sell their own legs or claim in kind.

## 2. Privy outage

**Signal:** Privy status page, or sign-in / signing error rate > 10%.

**Impact:** users with embedded wallets cannot sign in or sign. External-wallet users are unaffected.

1. Status-page notice: "Sign-in is degraded. Your money is safe in the vault and you can exit with an external wallet or an exported key."
2. The web app keeps browsing working; sign-in shows the outage notice.
3. Nothing to do on-chain. If the outage lasts more than 24 hours, publish the self-custody exit guide: export key → `cli.ts redeem` / `sell` / `claim`.

## 3. Token delisting (issuer delists, pauses, or the token leaves its feed)

**Signal:** catalog sync flags a token missing from its source, the issuer announces a delisting, or the token is paused (every transfer fails).

1. `set_asset_status(enabled=false, flagged=true)`: blocks the token from new buckets and edits. Existing buckets keep it.
2. List affected buckets (holdings contain the mint) and notify their creators and backers.
3. If the token is still tradable, the admin runs `admin_propose_removal(bucket, mint)` for each affected bucket. This is the same 24h public notice as any edit. The weight is spread pro rata over the other holdings, within each holding's cap, and the keeper sells it down after activation. If the rules can't be met (e.g. only one holding would remain), the call fails; notify the creator to edit or close the bucket instead.
4. If the token is paused, fills and rebalances for it fail and holders' slices stay reserved. Communicate clearly and follow the issuer's process (redemption, migration). When it resumes, rebalance.
5. Issuer expiry or redemption event (e.g. SpaceX PreStocks must be swapped before 12 Mar 2027; Tessera T-Tokens have a 90-day redemption window, and T-SpaceX is already in one). Disable the asset for new buckets as soon as the event is announced. Run `admin_propose_removal` on every affected bucket at least 30 days before the deadline, then have the keeper sell it down. Track the deadlines in the catalog.
6. Corporate action (split through a scaled-UI multiplier change): check the price service converted to raw-unit prices. If the on-chain price is off, the admin runs `force_price` at the effective time.

## 4. Stuck mint

**Signal:** a mint order open for more than 2× the normal fill time, or a leg failing repeatedly with `SlippageExceeded`.

1. Look at the order (`GET /v1/orders/:address` or `client.mintOrder`): which legs are done and which are failing.
2. `SlippageExceeded`: the venue is more than 1% (+ issuer fee) away from the on-chain price. Check the price feed for staleness or a clamp. If the market really moved, the price pusher catches up within a few pushes.
3. `StalePrice`: the price pusher is down; see (1) and restart it.
4. If the leg cannot fill: `close_mint_order` as keeper. The backer is refunded the unfilled USDC and keeps the tokens from filled legs. The vault drifts slightly off-weight; the next rebalance fixes it.

## 5. Suspected manipulation

**Signals:** a creator wallet trades a holding shortly before proposing an edit that adds or raises it (backend monitor, 2.4); a price push hits the ±20% clamp repeatedly; pool price more than 1% from unit price for over an hour; a thin pre-IPO token moves sharply just before settlement.

1. Freeze reputation, not funds: remove the bucket from the leaderboard (eligibility flag) and attach a notice to it.
2. Prices: settlement already uses min(spot, TWAP) and clamped pushes. If a feed is being gamed, the admin can `set_asset_status(enabled=false)` to stop new exposure.
3. A pending edit can't be vetoed on-chain. Backers were notified and can exit during the 24h window. Consider the admin removal path if the added token fails the liquidity floor.
4. Record evidence (signatures, timings) and apply the creator terms (delisting from the leaderboard, closure).

## 6. Program pause decision

The program has **no pause for redeem, by design**. The only switch is `Config.params.mints_paused` (admin), which stops new `open_mint` calls. Fills of already-open orders, and redeems, continue.

Pause mints when: a program bug is suspected in the mint path; prices are unreliable across many assets; the vault cap needs revisiting; or counsel requires it.

Decision: two of {tech lead, product lead, security lead} agree, then `update_config` with `mints_paused = true` (from the multisig on mainnet). Post the reason publicly. Unpause needs the same two.

For a suspected bug in redeem or the vault itself: an upgrade needs the upgrade authority (multisig). There is no instruction to freeze or move vault assets, and we will not add one.

## 7. A bucket exists on chain but not in the app

**Signal:** a creator publishes and the bucket is nowhere in the app: no bucket page, no order in their portfolio, and the leaderboard never mentions it. Or, on a fresh deployment, the catalog is empty and `/v1/health` shows `lastSync: null`. `indexer_state.updated_at` is stale.

`curl <api>/v1/health` answers the first question without any access to the database: `worker.lastRunAt: null` means no worker has ever run against this database — start it, nothing else is wrong yet. `worker.catalog.ok: false` with an `error` means the worker runs but the catalog job fails; the error text says why.

The vault is the source of truth; everything the app shows is a projection the indexer builds from program events. When the indexer stops, publishing still works on chain and the app simply goes blind. Nothing is lost — the projection rebuilds from the events.

1. Check that the worker is running (`pnpm --filter @bucket/backend worker`). The API and web alone do not index: the keeper (`pnpm --filter @bucket/backend keeper`) is separate again, and without it open mint orders never fill.
2. Compare `SELECT last_slot, updated_at FROM indexer_state` against the cluster's current slot. Stale means the indexer is stuck, not that the chain is.
3. Look for `RPC does not know the checkpoint signature; paging by slot` in the worker log. That warning is the indexer recovering by itself: a public cluster answers from a pool of nodes, and one that never saw (or has pruned) the checkpoint signature rejects `until` outright. If instead you see `failed to get signatures for address: Transaction … not found` at error level, the node is stuck on a build without that fallback.
4. Persistent RPC 429s throttle both indexing and fills. Move off the public endpoint to a dedicated RPC.
5. To rebuild the projection from scratch after a bad deploy: `pnpm --filter @bucket/backend rebuild`.
