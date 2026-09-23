import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emits .next/standalone with only the traced dependencies, so the container needs no node_modules.
  // `next start` still works from a normal build; this only adds the folder the Dockerfile copies.
  output: 'standalone',
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
