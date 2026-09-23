import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // DB-backed suites share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      BUCKET_SKIP_ENV_FILE: '1',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/bucket_test',
      CLUSTER: 'devnet',
      AUTH_MODE: 'dev',
      PUBLIC_WEB_URL: 'https://bucket.xyz',
      PLATFORM_FEE_WALLET: 'E9D5dRD7PQDvEDTgqRLsK1V6yquTfbCSgabAUCVmdYwi',
    },
  },
});
