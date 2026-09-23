import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the backend package root, found by walking up to its package.json (works from src/ and dist/). */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === '@bucket/backend') return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate @bucket/backend package root');
    dir = parent;
  }
}

export const packageRoot = findPackageRoot();
export const migrationsDir = join(packageRoot, 'migrations');
export const fontsDir = join(packageRoot, 'assets', 'fonts');
