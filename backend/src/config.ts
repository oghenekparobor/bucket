import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUCKET_VAULT_PROGRAM_ID, MAINNET_USDC_MINT } from '@bucket/sdk';
import { z } from 'zod';
import { type Deployment, loadDeployment, repoRoot } from './chain/deployment.js';
import { packageRoot } from './paths.js';

// Load backend/.env when present (Node 22 built-in; never overrides real env vars).
const envFile = join(packageRoot, '.env');
if (existsSync(envFile) && !process.env.BUCKET_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().default('postgres://localhost:5432/bucket_dev'),

  // Chain settings default from vault/deployments/<CLUSTER>.json; env values override.
  CLUSTER: z.enum(['localnet', 'devnet', 'mainnet-beta']).default('devnet'),
  DEPLOYMENT_PATH: optionalString,
  RPC_URL: optionalString,
  PROGRAM_ID: optionalString,
  USDC_MINT: optionalString,
  PLATFORM_FEE_WALLET: optionalString,

  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  AUTH_MODE: z.enum(['privy', 'dev']).default('privy'),
  PRIVY_APP_ID: optionalString,
  PRIVY_APP_SECRET: optionalString,
  /** Signing secret of the Privy dashboard webhook ("whsec_…"). Without it the webhook route is off. */
  PRIVY_WEBHOOK_SECRET: optionalString,
  DEV_AUTH_MAX_AGE_SECS: z.coerce.number().int().default(86_400),

  WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(30),
  // Edge geo headers, first match wins (Cloudflare, then Vercel).
  GEO_COUNTRY_HEADERS: z.string().default('cf-ipcountry,x-vercel-ip-country'),
  GEO_REGION_HEADERS: z.string().default('cf-region-code,x-vercel-ip-country-region'),

  JUPITER_API_BASE: z.string().default('https://lite-api.jup.ag'),
  JUPITER_MIN_INTERVAL_MS: z.coerce.number().int().default(300),
  PRESTOCKS_URL: z.string().default('https://prestocks.com/api/prestocks'),
  TESSERA_URL: z.string().default('https://rest-api.tessera.pe/v1/public/token-details'),
  LIQUIDITY_FLOOR_USD: z.coerce.number().default(250_000),
  MAX_PRICE_IMPACT_PCT: z.coerce.number().default(1),
  REQUIRE_QUOTE_PROBE: bool,
  MAX_MIN_TRADE_USD: z.coerce.number().default(1),
  MOCK_SWAP_FEE_BPS: z.coerce.number().int().default(30),
  MINT_FEE_BPS: z.coerce.number().int().default(20),
  REDEEM_FEE_BPS: z.coerce.number().int().default(0),
  MIN_DEPOSIT_USD: z.coerce.number().default(1),
  MIN_CREATOR_DEPOSIT_USD: z.coerce.number().default(25),

  LEADERBOARD_ENFORCE_ELIGIBILITY: bool,
  CARD_CACHE_TTL_SECS: z.coerce.number().int().default(300),

  ALERT_WEBHOOK_URL: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default('Bucket <notifications@bucket.xyz>'),
  TELEGRAM_BOT_TOKEN: optionalString,

  // Default to the repo's keys/ directory (gitignored) when the files exist.
  KEEPER_KEYPAIR_PATH: optionalString,
  FEE_PAYER_KEYPAIR_PATH: optionalString,
  PRICE_AUTHORITY_KEYPAIR_PATH: optionalString,
  KEEPER_INTERVAL_MS: z.coerce.number().int().default(5_000),
  KEEPER_MIN_SOL: z.coerce.number().default(0.5),
  FEE_PAYER_MIN_SOL: z.coerce.number().default(1),
  KEEPER_REBALANCE: bool,
  POOL_GAP_ALERT_PCT: z.coerce.number().default(1),
});

type RawConfig = z.infer<typeof schema>;

export type Config = Omit<RawConfig, 'RPC_URL' | 'PROGRAM_ID' | 'USDC_MINT' | 'PLATFORM_FEE_WALLET'> & {
  RPC_URL: string;
  PROGRAM_ID: string;
  USDC_MINT: string;
  PLATFORM_FEE_WALLET: string;
  deployment: Deployment | null;
};

const CLUSTER_RPC: Record<RawConfig['CLUSTER'], string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

const keyFile = (name: string) => {
  const path = join(repoRoot, 'keys', `${name}.json`);
  return existsSync(path) ? path : undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const deployment = loadDeployment(c.CLUSTER, c.DEPLOYMENT_PATH);
  return {
    ...c,
    deployment,
    RPC_URL: c.RPC_URL ?? deployment?.rpcUrl ?? CLUSTER_RPC[c.CLUSTER],
    PROGRAM_ID: c.PROGRAM_ID ?? deployment?.programs.bucketVault ?? BUCKET_VAULT_PROGRAM_ID.toBase58(),
    USDC_MINT: c.USDC_MINT ?? deployment?.usdcMint ?? MAINNET_USDC_MINT.toBase58(),
    PLATFORM_FEE_WALLET: c.PLATFORM_FEE_WALLET ?? deployment?.roles.feeWallet ?? 'platform',
    KEEPER_KEYPAIR_PATH: c.KEEPER_KEYPAIR_PATH ?? keyFile('keeper'),
    FEE_PAYER_KEYPAIR_PATH: c.FEE_PAYER_KEYPAIR_PATH ?? keyFile('fee-payer'),
    PRICE_AUTHORITY_KEYPAIR_PATH: c.PRICE_AUTHORITY_KEYPAIR_PATH ?? keyFile('price-authority'),
  };
}

export const config: Config = loadConfig();
