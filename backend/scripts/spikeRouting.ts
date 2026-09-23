/**
 * Phase 0.3 spike: syncs the live catalog, then probes Jupiter routing for every token (smallest USDC
 * amount with a route under the price-impact bound, and depth under that bound for tokens with ≥$50k
 * liquidity), and times the Tessera endpoint. Prints a markdown report used in
 * docs/spikes/catalog-and-routing.md and stores the probe results on each asset.
 *
 *   pnpm --filter @bucket/backend spike:routing > report.md
 */
import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { fetchTessera } from '../src/catalog/sources/tessera.js';
import type { ProbeResult } from '../src/catalog/routingProbe.js';
import { runCatalogSync } from '../src/jobs/catalogSync.js';
import { runRoutingProbe } from '../src/jobs/routingProbe.js';

const db = createPool();
const log = (s = '') => process.stdout.write(`${s}\n`);
const money = (n: number | null) => (n === null ? '—' : n >= 1_000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n}`);

try {
  await migrate(db);
  const started = new Date();
  const sync = await runCatalogSync(db);

  // Tessera timing: 10 sequential requests.
  const tessera: { status: number | null; ms: number; ok: boolean }[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await fetchTessera();
    tessera.push({ status: r.status, ms: r.latencyMs, ok: r.ok });
  }

  const results = new Map<string, ProbeResult>();
  const probe = await runRoutingProbe(db, { minLiquidityUsd: 0, depth: true, onResult: (mint, r) => results.set(mint, r) });

  const rows = (
    await db.query(
      `SELECT mint, ticker, source, liquidity_usd, eligible, price_e6, ui_price_e6 FROM assets WHERE source_payload IS NOT NULL
       ORDER BY source, liquidity_usd DESC NULLS LAST`,
    )
  ).rows;

  log(`## Run of ${started.toISOString()}`);
  log();
  log(`Liquidity floor: ${money(config.LIQUIDITY_FLOOR_USD)} (Jupiter \`liquidity\`), max price impact ${config.MAX_PRICE_IMPACT_PCT}%.`);
  log(`Sources: ${sync.sources.map((s) => `${s.source} ${s.ok ? 'ok' : 'FAILED'} (${s.tokens})`).join(', ')}. Probed ${probe.probed} tokens with ${probe.quotes} quotes.`);
  log();
  log('| Source | Tokens | Priced on Jupiter | Above floor (eligible) | Routable under 1% impact |');
  log('| --- | ---: | ---: | ---: | ---: |');
  for (const source of ['xStocks', 'PreStocks', 'Tessera']) {
    const s = rows.filter((r) => r.source === source);
    const routable = s.filter((r) => results.get(r.mint)?.minTradeUsd !== null && results.has(r.mint)).length;
    log(`| ${source} | ${s.length} | ${s.filter((r) => r.price_e6 !== null).length} | ${s.filter((r) => r.eligible).length} | ${routable} |`);
  }
  log();
  log('Tessera `token-details`, 10 sequential requests: ' + tessera.map((t) => `${t.status ?? 'ERR'}/${t.ms}ms`).join(', '));
  log();
  log('| Ticker | Source | Liquidity | Eligible | Min size < 1% impact | Cost at min size | Depth < 1% impact (ladder $1k/$10k/$50k/$250k) | Route at min size |');
  log('| --- | --- | ---: | :---: | ---: | ---: | ---: | --- |');
  for (const r of rows) {
    const p = results.get(r.mint);
    if (!p) {
      log(`| ${r.ticker} | ${r.source} | ${money(r.liquidity_usd === null ? null : Number(r.liquidity_usd))} | ${r.eligible ? 'yes' : 'no'} | no price | — | — | — |`);
      continue;
    }
    const at = p.samples.find((s) => s.usd === p.minTradeUsd);
    const lastErr = p.samples.at(-1)?.error;
    log(
      `| ${r.ticker} | ${r.source} | ${money(r.liquidity_usd === null ? null : Number(r.liquidity_usd))} | ${r.eligible ? 'yes' : 'no'} | ${p.minTradeUsd === null ? `no route${lastErr ? ` (${lastErr.slice(0, 40).replace(/\|/g, '/')})` : ''}` : money(p.minTradeUsd)} | ${at?.deviationPct == null ? '—' : `${at.deviationPct.toFixed(2)}%`} | ${p.depthUsd === null ? (p.minTradeUsd === null ? '—' : '< $1,000') : `≥ ${money(p.depthUsd)}`} | ${at?.route ?? '—'} |`,
    );
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await db.end();
}
