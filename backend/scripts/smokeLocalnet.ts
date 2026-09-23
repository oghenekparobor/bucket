/**
 * End-to-end smoke test through the HTTP API against a running validator (localnet or devnet), with
 * the API (AUTH_MODE=dev), worker and keeper running:
 *
 *   faucet → create bucket (publish txs + creator's first mint) → keeper fills → backer mints →
 *   backer redeems half → creator edits the name → portfolio / bucket detail show indexed numbers.
 *
 *   API_URL=http://localhost:4000 pnpm --filter @bucket/backend smoke:localnet
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { signDevToken } from '../src/api/auth.js';
import { sleep } from '../src/util/time.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const HOLDINGS: [string, number][] = [
  ['AAPLx', 30],
  ['SPYx', 25],
  ['GOOGLx', 25],
  ['tOpenAI', 20],
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(method: 'GET' | 'POST', path: string, body?: unknown, who?: Keypair): Promise<Json> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${signDevToken(who.secretKey, who.publicKey.toBase58())}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json()) as Json;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Co-signs a fee-payer-signed transaction if `who` must sign it, then relays it through the API. */
async function signAndSubmit(base64: string, who: Keypair): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  if (signers.some((k) => k.equals(who.publicKey))) tx.sign([who]);
  const { signature } = await api('POST', '/v1/tx/submit', { transaction: Buffer.from(tx.serialize()).toString('base64') }, who);
  return signature;
}

/** Waits until the indexer has the order and the keeper has finished it. */
async function waitForOrder(order: string, timeoutMs = 120_000): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${API}/v1/orders/${order}`);
    if (res.ok) {
      const o = (await res.json()) as Json;
      if (o.status === 'done' || o.status === 'refunded') return o;
    }
    if (Date.now() > deadline) throw new Error(`order ${order} not finished after ${timeoutMs / 1000}s`);
    await sleep(2_000);
  }
}

const fmtTokens = (raw: string) => (Number(raw) / 1e6).toFixed(6);

const creator = Keypair.generate();
const backer = Keypair.generate();
console.log(`creator ${creator.publicKey.toBase58()}\nbacker  ${backer.publicKey.toBase58()}`);

for (const who of [creator, backer]) await api('POST', '/v1/faucet', {}, who);
console.log('faucet: $1,000 mock USDC each ->', (await api('GET', '/v1/me', undefined, backer)).usdcBalance);

const catalog = await api('GET', '/v1/catalog');
const mintOf = (ticker: string) => {
  const t = catalog.tokens.find((x: Json) => x.ticker === ticker);
  if (!t?.eligible) throw new Error(`${ticker} is not an eligible catalog token here`);
  return t.mint as string;
};

const created = await api(
  'POST',
  '/v1/tx/create-bucket',
  {
    name: `Smoke Test ${Date.now() % 100_000}`,
    thesis: 'Four liquid names, one pre-IPO sleeve. Built by the backend smoke test.',
    holdings: HOLDINGS.map(([t, w]) => ({ mint: mintOf(t), weightPct: w })),
    stakeUsd: '100',
  },
  creator,
);
console.log(`create-bucket: ${created.transactions.length} transactions for ${created.bucket} (/b/${created.slug})`);
for (const tx of created.transactions) console.log('  submitted', await signAndSubmit(tx, creator));
const first = await waitForOrder(created.order);
console.log(`creator mint ${first.status}: ${fmtTokens(first.tokens)} tokens for $${first.usdc}; legs ${first.legs.map((l: Json) => `${l.ticker}:${l.status}`).join(' ')}`);

const quote = await api('GET', `/v1/quote/mint?bucket=${created.slug}&amount=250`);
console.log(`quote $250: route ${quote.chosen}, ${fmtTokens(quote.routes[0].tokensOut)} tokens at $${quote.routes[0].effectivePrice} (${quote.routes[0].effectiveVsUnitPct}% vs unit), fee $${quote.feeUsd}, rent $${quote.rentUsd}`);
const mint = await api('POST', '/v1/tx/mint', { bucket: created.slug, amountUsd: '250' }, backer);
console.log('backer mint submitted', await signAndSubmit(mint.transaction, backer));
const backerOrder = await waitForOrder(mint.order);
console.log(`backer mint ${backerOrder.status}: ${fmtTokens(backerOrder.tokens)} tokens`);

const half = (BigInt(backerOrder.tokens) / 2n).toString();
const redeem = await api('POST', '/v1/tx/redeem', { bucket: created.slug, tokens: half }, backer);
console.log('backer redeem submitted', await signAndSubmit(redeem.transaction, backer));
const redeemOrder = await waitForOrder(redeem.order);
console.log(`backer redeem ${redeemOrder.status}: ${fmtTokens(redeemOrder.tokens)} tokens -> $${redeemOrder.usdc}`);

const info = await api('POST', '/v1/tx/update-info', { bucket: created.slug, name: `${created.slug.replace(/-/g, ' ')} (renamed)`, thesis: 'Renamed by the smoke test.' }, creator);
console.log('update-info submitted', await signAndSubmit(info.transaction, creator));

await sleep(6_000); // let the indexer catch the last events
const detail = await api('GET', `/v1/buckets/${created.slug}`);
console.log(`bucket: "${detail.name}" unit $${detail.unitPrice} supply ${fmtTokens(detail.supply)} backed $${detail.totalBacked} holders ${detail.holders} events ${detail.eventCount}`);
for (const who of [creator, backer]) {
  const p = await api('GET', '/v1/me/portfolio', undefined, who);
  const pos = p.positions[0];
  console.log(`${who === creator ? 'creator' : 'backer '} portfolio: ${fmtTokens(pos.tokens)} tokens, value $${pos.value}, paid $${pos.paid}, gain $${pos.gainUsd} (${pos.gainPct}%)`);
}
console.log(`PASS  slug=${created.slug} bucket=${created.bucket}`);
