// Railway builds the last stage of the Dockerfile it is given and cannot pass --target, so the web
// service points at web.Dockerfile, which is Dockerfile with the TARGET selector removed so that the
// `web` stage ends up last. Two files describing one build drift apart silently — and when they do,
// the web service quietly ships the backend image, which is what happened on 23 Sep 2026.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '../src/paths.js';

const repoRoot = join(packageRoot, '..');
const read = (f: string) => readFileSync(join(repoRoot, f), 'utf8');

/** web.Dockerfile is Dockerfile minus the global TARGET arg and the final selector stage. */
function derive(main: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of main.split('\n')) {
    if (line.startsWith('ARG TARGET=')) continue;
    if (line.startsWith('# ── final stage selector')) skipping = true;
    if (skipping) continue;
    out.push(line);
  }
  return `${out.join('\n').trimEnd()}\n`;
}

const lastStage = (df: string) => [...df.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].at(-1)?.[1];

describe('Dockerfile and web.Dockerfile', () => {
  const main = read('Dockerfile');
  const web = read('web.Dockerfile');

  it('web.Dockerfile still matches Dockerfile (edit Dockerfile, then regenerate)', () => {
    // Its header is the only addition; everything after must be the derived body.
    const body = web.slice(web.indexOf('# syntax='));
    expect(body).toBe(derive(main));
  });

  it('builds the web image when no target is given', () => {
    expect(lastStage(web)).toBe('web');
  });

  it('the main Dockerfile defaults to the backend image', () => {
    expect(lastStage(main)).toBe('final');
    expect(main).toMatch(/^ARG TARGET=backend$/m);
    expect(main).toMatch(/^FROM \$\{TARGET\} AS final$/m);
  });

  it('both define the stages each one needs', () => {
    for (const [name, df] of [
      ['Dockerfile', main],
      ['web.Dockerfile', web],
    ] as const) {
      const stages = new Set([...df.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].map((m) => m[1]!));
      expect(stages, `${name} is missing a stage`).toContain('build');
      expect(stages, `${name} is missing a stage`).toContain('web');
    }
  });
});
