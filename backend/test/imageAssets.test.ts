// The backend reads data files from disk at runtime, and `tsc` does not copy them into dist/. Any one
// of them missing from the container is a crash on boot, not a degraded feature — the deployed image
// died with ENOENT on config/geo-restrictions.json, which buildApp reads before it serves anything.
//
// This test fails if a runtime file is not copied into the backend image, so the Dockerfile has to
// keep up with the code rather than being fixed one ENOENT at a time.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontsDir, migrationsDir, packageRoot } from '../src/paths.js';

const repoRoot = join(packageRoot, '..');
const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');

/** Source paths the runtime stage copies, relative to the build context. */
function copiedPaths(): string[] {
  const stage = dockerfile.split(/^FROM /m).find((s) => s.startsWith('base AS runtime')) ?? '';
  return [...stage.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/gm)]
    .map((m) => m[1]!)
    .filter((src) => !src.startsWith('/')); // --from=<stage> copies are build output, not context files
}

/** Every file the backend opens at runtime, as a path relative to the repo root. */
const runtimeFiles = [
  ...readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => `backend/migrations/${f}`),
  ...readdirSync(fontsDir).map((f) => `backend/assets/fonts/${f}`),
  // read by api/geo.ts while the app is built, and by catalog/issuerEvents.ts
  'backend/config/geo-restrictions.json',
  'backend/config/issuer-events.json',
  // program ids and the USDC mint, resolved by config.ts one level above the package root
  'vault/deployments/devnet.json',
];

describe('the image carries every file the backend reads at runtime', () => {
  const copied = copiedPaths();

  it('copies something at all (the runtime stage is still parseable)', () => {
    expect(copied.length).toBeGreaterThan(0);
  });

  for (const file of runtimeFiles) {
    it(`ships ${file}`, () => {
      expect(existsSync(join(repoRoot, file)), `${file} is missing from the repo`).toBe(true);
      const shipped = copied.some((src) => file === src || file.startsWith(`${src}/`));
      expect(shipped, `${file} is read at runtime but no COPY in the runtime stage brings it into the image`).toBe(true);
    });
  }

  it('ships both halves of the Next standalone bundle', () => {
    // Next keeps pnpm's layout: web/node_modules/* are symlinks into a hidden store at
    // <root>/node_modules/.pnpm. Copying the app without the store leaves every symlink dangling and
    // server.js dies with "Cannot find module 'next'" — which is how the first web deploy failed.
    const stage = dockerfile.split(/^FROM /m).find((s) => s.startsWith('base AS runtime')) ?? '';
    const copies = [...stage.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/gm)].map((m) => [m[1]!, m[2]!]);
    const has = (src: string, dst: string) => copies.some(([s, d]) => s === src && d === dst);
    expect(has('/app/web/.next/standalone/node_modules', './node_modules/'), 'the hidden pnpm store the symlinks point into').toBe(true);
    expect(has('/app/web/.next/standalone/web', './web/'), 'server.js and the traced app').toBe(true);
    expect(has('/app/web/.next/static', './web/.next/static'), 'static assets are not part of standalone').toBe(true);
    // Order matters: the store must land in the same node_modules the backend's install created.
    const storeIdx = copies.findIndex(([s]) => s === '/app/web/.next/standalone/node_modules');
    const backendIdx = copies.findIndex(([s]) => s === '/app');
    expect(storeIdx).toBeGreaterThan(backendIdx);
  });

  it('keeps the data directories out of .dockerignore', () => {
    const ignore = readFileSync(join(repoRoot, '.dockerignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    for (const dir of ['backend/migrations', 'backend/assets', 'backend/config', 'vault/deployments']) {
      expect(ignore, `.dockerignore would exclude ${dir}`).not.toContain(dir);
    }
  });
});
