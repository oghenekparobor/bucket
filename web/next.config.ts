import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The pnpm workspace root (bucket/), so file tracing does not pick up a lockfile above the repo.
  outputFileTracingRoot: path.join(__dirname, '..'),
  webpack: (config) => {
    // Optional peer deps pulled in by wallet SDKs that are never used in this app.
    config.externals = [...(config.externals ?? []), 'pino-pretty', 'lokijs', 'encoding'];
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), '@farcaster/mini-app-solana': false };
    // viem/ox (pulled in by Privy for EVM support) use dynamic requires webpack cannot analyse; harmless here.
    config.ignoreWarnings = [...(config.ignoreWarnings ?? []), { module: /node_modules\/.*\/ox\//, message: /Critical dependency/ }];
    return config;
  },
};

export default nextConfig;
