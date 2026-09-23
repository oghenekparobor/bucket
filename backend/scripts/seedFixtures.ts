/**
 * Loads the design's sample dataset (six buckets, creators, 20-token catalog) as synthetic program
 * events through the real ingestion + projection path, then runs the performance and leaderboard jobs.
 * Everything written is marked `fixture` and removed by `--wipe` (or before every re-seed).
 *
 *   pnpm --filter @bucket/backend seed:fixtures        # (re)seed
 *   pnpm --filter @bucket/backend seed:wipe            # remove fixture data only
 */
import { pathToFileURL } from 'node:url';
import { recomputeEligibility } from '../src/catalog/repo.js';
import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db, withTx } from '../src/db/pool.js';
import { FIXTURE_ASSETS, FIXTURE_BUCKETS } from '../src/fixtures/design.js';
import { buildPricePath, fixtureAddress, type FixtureMarket, rng, simulate } from '../src/fixtures/simulator.js';
import { ingestEvents } from '../src/indexer/ingest.js';
import { eligibilityRules } from '../src/jobs/catalogSync.js';
import { runLeaderboard } from '../src/jobs/leaderboard.js';
import { runPerformance } from '../src/jobs/performance.js';
import { big } from '../src/util/money.js';
import { slugify } from '../src/util/slug.js';
import { DAY_MS } from '../src/util/time.js';
import { rebuild } from './rebuild.js';

export async function wipeFixtures(db: Db): Promise<void> {
  await withTx(db, async (c) => {
    await c.query(`DELETE FROM notifications WHERE event_id IN (SELECT id FROM events WHERE fixture)`);
    await c.query(`DELETE FROM bucket_slugs WHERE bucket IN (SELECT address FROM buckets WHERE fixture)`);
    await c.query(`DELETE FROM events WHERE fixture`);
    await c.query(`DELETE FROM backer_attributions WHERE fixture`);
    await c.query(`DELETE FROM link_clicks WHERE fixture`);
    await c.query(`DELETE FROM pool_prices WHERE fixture`);
    await c.query(`DELETE FROM asset_prices WHERE fixture`);
    await c.query(`DELETE FROM users WHERE fixture`);
    await c.query(`DELETE FROM assets WHERE fixture AND source_payload IS NULL`);
  });
  await rebuild(db);
}

export async function seedFixtures(db: Db, now = new Date()) {
  const nowMs = now.getTime();
  await wipeFixtures(db);

  // Catalog: reuse live catalog rows (real mints, live prices) where they exist; otherwise add fixture rows.
  const markets = new Map<string, FixtureMarket>();
  for (const a of FIXTURE_ASSETS) {
    const mint = a.mint ?? fixtureAddress(`asset:${a.ticker}`);
    const live = await db.query<{ price_e6: string | null }>(`SELECT price_e6 FROM assets WHERE mint = $1`, [mint]);
    const livePrice = live.rows[0]?.price_e6;
    const endPrice = livePrice ? Number(big(livePrice)) / 1e6 : a.price;
    if (live.rowCount === 0) {
      const e6 = (n: number | null) => (n === null ? null : BigInt(Math.round(n * 1e6)).toString());
      await db.query(
        `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, token_program, price_e6, ui_price_e6, price_updated_at,
           mark_price_e6, liquidity_usd, last_seen_at, fixture)
         VALUES ($1, $2, $3, $4, $5, $6, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', $7, $7, $8, $9, $10, $8, true)`,
        [mint, a.ticker, a.name, a.source, a.assetType, a.decimals, e6(a.price), now, e6(a.mark), a.liquidityUsd],
      );
    }
    markets.set(a.ticker, { asset: a, mint, path: buildPricePath(a, endPrice, nowMs) });
  }

  const sim = simulate(markets, nowMs);

  for (const c of sim.creators) {
    await db.query(
      `INSERT INTO users (wallet, display_name, x_handle, x_verified, fixture) VALUES ($1, $2, $3, true, true)
       ON CONFLICT (wallet) DO UPDATE SET display_name = EXCLUDED.display_name, x_handle = EXCLUDED.x_handle, x_verified = true, fixture = true`,
      [c.wallet, c.name, c.handle],
    );
  }

  // Share-link clicks: one before each attributed first mint, plus non-converting visits.
  const slugByBucket = new Map(sim.buckets.map((b) => [b.address, slugify(FIXTURE_BUCKETS.find((d) => d.key === b.key)!.name)]));
  const r = rng(7);
  const clicks: { slug: string; at: Date; wallet: string | null }[] = [];
  for (const a of sim.attributions) if (a.viaLink) clicks.push({ slug: slugByBucket.get(a.bucket)!, at: new Date(a.at - (1 + r() * 20) * 60_000), wallet: a.wallet });
  for (const d of FIXTURE_BUCKETS) {
    const slug = slugify(d.name);
    for (let i = 0; i < d.holders * 7; i++) clicks.push({ slug, at: new Date(nowMs - Math.pow(r(), 0.8) * d.ageDays * DAY_MS), wallet: null });
  }
  const ids = await db.query<{ id: string }>(
    `INSERT INTO link_clicks (slug, ref, ip_hash, ua_hash, clicked_at, fixture)
     SELECT slug, 'x', md5(random()::text), md5(random()::text), at, true FROM unnest($1::text[], $2::timestamptz[]) AS t(slug, at)
     RETURNING id`,
    [clicks.map((c) => c.slug), clicks.map((c) => c.at)],
  );
  const attributed = new Map(clicks.map((c, i) => [c.wallet ? `${c.wallet}:${c.slug}` : '', ids.rows[i]!.id]));
  await db.query(
    `INSERT INTO backer_attributions (wallet, bucket, click_id, via_link, created_at, fixture)
     SELECT * , true FROM unnest($1::text[], $2::text[], $3::bigint[], $4::boolean[], $5::timestamptz[])
     ON CONFLICT (wallet, bucket) DO NOTHING`,
    [
      sim.attributions.map((a) => a.wallet),
      sim.attributions.map((a) => a.bucket),
      sim.attributions.map((a) => (a.viaLink ? attributed.get(`${a.wallet}:${slugByBucket.get(a.bucket)}`) ?? null : null)),
      sim.attributions.map((a) => a.viaLink),
      sim.attributions.map((a) => new Date(a.at)),
    ],
  );

  const inserted = await ingestEvents(db, sim.events, { platformWallet: config.PLATFORM_FEE_WALLET, nowMs });
  await recomputeEligibility(db, eligibilityRules());
  await runPerformance(db, now);

  // Pool prices at the design's premium, sampled every 5 minutes over the last hour.
  for (const b of sim.buckets) {
    const m = await db.query<{ unit_price_e6: string }>(`SELECT unit_price_e6 FROM bucket_metrics WHERE bucket = $1`, [b.address]);
    const unit = Number(m.rows[0]?.unit_price_e6 ?? 0);
    for (let i = 0; i <= 12; i++) {
      const at = new Date(nowMs - (12 - i) * 5 * 60_000);
      const p = Math.round(unit * (1 + b.prem + (r() - 0.5) * 0.0004));
      await db.query(`INSERT INTO pool_prices (bucket, ts, price_e6, source, fixture) VALUES ($1, $2, $3, 'fixture', true) ON CONFLICT DO NOTHING`, [b.address, at, p]);
    }
  }
  const board = await runLeaderboard(db, now);
  return { events: inserted, buckets: sim.buckets.length, creators: sim.creators.length, attributions: sim.attributions.length, clicks: clicks.length, eligible: board.eligible };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool();
  try {
    await migrate(db);
    const started = Date.now();
    if (process.argv.includes('--wipe')) {
      await wipeFixtures(db);
      console.log('fixture data removed');
    } else {
      const result = await seedFixtures(db);
      console.log(`seeded ${JSON.stringify(result)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
