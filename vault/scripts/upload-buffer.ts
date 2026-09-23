// Paced, resumable program-buffer upload for rate-limited RPCs (the public
// devnet endpoint answers `solana program write-buffer --use-rpc` with 429s).
// Writes only the chunks that differ from what the buffer already holds, a few
// transactions per second, and re-checks the buffer between rounds, so it can
// be stopped and rerun at any time. Then deploy from the finished buffer:
//
//   pnpm exec tsx upload-buffer.ts --program ../target/deploy/bucket_vault.so \
//     --buffer ../../keys/bucket_vault-buffer.json [--rps 3]
//   solana program deploy --buffer <buffer address> --program-id ../../keys/bucket_vault.json \
//     --upgrade-authority ../../keys/deployer.json --keypair ../../keys/deployer.json -u devnet
//
// The buffer must already exist (created by `solana program write-buffer`, even if it failed part way).

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const here = dirname(fileURLToPath(import.meta.url));
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
/** UpgradeableLoaderState::Buffer header: enum tag (4) + Option<Pubkey> (1 + 32). */
const BUFFER_META = 37;
const CHUNK = 920;
/** Loader v3 Write needs ~2.4k CU; ask for a little more and pay for priority. */
const WRITE_CU = 6_000;
const PRIORITY_MICROLAMPORTS = 100_000;

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
};
const loadKey = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(p), 'utf8'))));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries an RPC read through 429s and transient network errors (the public endpoint throttles per IP for a while after a burst). */
async function patiently<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 12 || !/429|Too many|fetch failed|ECONNRESET|ETIMEDOUT|socket|timeout|50[234]/i.test(String(e))) throw e;
      const wait = Math.min(60_000, 5_000 * attempt);
      console.log(`${what}: ${/429|Too many/i.test(String(e)) ? 'rate limited' : 'network error'}, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

/**
 * Reads the buffer in slices: a single ~900 KB getAccountInfo response is often cut off on the
 * public endpoint ("fetch failed"), while small slices come back reliably.
 */
async function readBuffer(connection: Connection, buffer: PublicKey, length: number): Promise<Buffer> {
  const SLICE = 128 * 1024;
  const parts: Buffer[] = [];
  for (let offset = 0; offset < length; offset += SLICE) {
    const len = Math.min(SLICE, length - offset);
    const info = await patiently('read buffer', () => connection.getAccountInfo(buffer, { dataSlice: { offset, length: len } }));
    if (!info) throw new Error(`buffer ${buffer.toBase58()} does not exist; create it with solana program write-buffer first`);
    if (info.data.length < len) throw new Error('buffer is smaller than the program');
    parts.push(info.data);
  }
  return Buffer.concat(parts);
}

/** bincode UpgradeableLoaderInstruction::Write { offset: u32, bytes: Vec<u8> } */
function writeIx(buffer: PublicKey, authority: PublicKey, offset: number, bytes: Buffer) {
  const data = Buffer.alloc(4 + 4 + 8 + bytes.length);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  bytes.copy(data, 16);
  return new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const program = readFileSync(resolve(arg('program')));
  const bufferKey = loadKey(arg('buffer')).publicKey;
  const authority = loadKey(arg('authority', join(here, '..', '..', 'keys', 'deployer.json')));
  const rps = Number(arg('rps', '3'));
  // disableRetryOnRateLimit: back off here instead of web3.js hammering the endpoint every 500 ms
  const connection = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', { commitment: 'confirmed', disableRetryOnRateLimit: true });
  const chunks = Math.ceil(program.length / CHUNK);

  for (let round = 1; ; round++) {
    const data = await readBuffer(connection, bufferKey, BUFFER_META + program.length);
    const info = { data };
    const pending: number[] = [];
    for (let i = 0; i < chunks; i++) {
      const a = program.subarray(i * CHUNK, (i + 1) * CHUNK);
      const b = info.data.subarray(BUFFER_META + i * CHUNK, BUFFER_META + i * CHUNK + a.length);
      if (!a.equals(b)) pending.push(i);
    }
    console.log(`round ${round}: ${chunks - pending.length}/${chunks} chunks in place, ${pending.length} to write`);
    if (pending.length === 0) break;

    // One blockhash lasts ~60 s. Send a batch, then resend whatever has not landed while the blockhash
    // is still valid, then re-read the buffer. Writes ask for a small compute budget with a priority
    // fee so leaders don't deprioritize them (a default 200k-CU request with a tiny fee mostly drops).
    const { blockhash } = await patiently('blockhash', () => connection.getLatestBlockhash('confirmed'));
    const batch = pending.slice(0, Math.floor(20 * rps));
    const sent: { sig: string; raw: Uint8Array }[] = [];
    const send = async (raw: Uint8Array) => {
      for (let attempt = 0; ; attempt++) {
        try {
          // no maxRetries: the RPC node keeps rebroadcasting until the blockhash expires
          return await connection.sendRawTransaction(raw, { skipPreflight: true });
        } catch (e) {
          if (attempt >= 5) throw e;
          await sleep(3_000 * (attempt + 1)); // rate limited: back off
        }
      }
    };
    for (const i of batch) {
      const bytes = program.subarray(i * CHUNK, (i + 1) * CHUNK);
      const msg = new TransactionMessage({
        payerKey: authority.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: WRITE_CU }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
          writeIx(bufferKey, authority.publicKey, i * CHUNK, bytes),
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([authority]);
      const raw = tx.serialize();
      sent.push({ sig: await send(raw), raw });
      await sleep(1_000 / rps);
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(5_000);
      const statuses = await patiently('statuses', () => connection.getSignatureStatuses(sent.map((x) => x.sig)));
      const open = sent.filter((_, k) => !statuses.value[k]?.confirmationStatus);
      if (open.length === 0) break;
      for (const o of open) {
        if (Date.now() > deadline) break;
        await send(o.raw).catch(() => undefined);
        await sleep(1_000 / rps);
      }
    }
  }
  console.log(`buffer ${bufferKey.toBase58()} holds the full program (${program.length} bytes)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
