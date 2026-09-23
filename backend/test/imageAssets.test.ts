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

/** Source paths the backend stage copies, relative to the build context. */
function copiedPaths(): string[] {
  const stage = dockerfile.split(/^FROM /m).find((s) => s.startsWith('base AS backend')) ?? '';
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

describe('the backend image carries every file the backend reads at runtime', () => {
  const copied = copiedPaths();

  it('copies something at all (the Dockerfile stage is still parseable)', () => {
    expect(copied.length).toBeGreaterThan(0);
  });

  for (const file of runtimeFiles) {
    it(`ships ${file}`, () => {
      expect(existsSync(join(repoRoot, file)), `${file} is missing from the repo`).toBe(true);
      const shipped = copied.some((src) => file === src || file.startsWith(`${src}/`));
      expect(shipped, `${file} is read at runtime but no COPY in the backend stage brings it into the image`).toBe(true);
    });
  }

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
