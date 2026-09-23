/**
 * The vault deployment record written by vault/scripts/setup.ts (`vault/deployments/<cluster>.json`):
 * program ids, mock USDC, role addresses and the allow-listed tokens with the mainnet mint each devnet /
 * localnet mock mirrors.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../paths.js';

export interface DeploymentToken {
  symbol: string;
  name: string;
  source: string;
  kind: string;
  mainnetMint: string;
  decimals: number;
  transferFeeBps: number;
  mint: string;
  tokenProgram: string;
}

export interface Deployment {
  cluster: string;
  rpcUrl: string;
  programs: { bucketVault: string; mockSwap: string };
  usdcMint: string;
  roles: { admin: string; keeper: string; priceAuthority: string; feeWallet: string; feePayer: string };
  tokens: DeploymentToken[];
}

export const repoRoot = join(packageRoot, '..');

/** Reads the deployment for a cluster (`mainnet-beta` → mainnet.json), or null when there is none. */
export function loadDeployment(cluster: string, path?: string): Deployment | null {
  const file = path ?? join(repoRoot, 'vault', 'deployments', `${cluster === 'mainnet-beta' ? 'mainnet' : cluster}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Deployment;
}
