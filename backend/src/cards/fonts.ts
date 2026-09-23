import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Font } from 'satori';
import { fontsDir } from '../paths.js';
import { MONO, SANS } from './h.js';

let cached: Font[] | null = null;

/** Archivo 400–700 and JetBrains Mono 400–500 (OFL, bundled under assets/fonts). */
export function loadFonts(): Font[] {
  if (cached) return cached;
  const load = (file: string) => readFileSync(join(fontsDir, file));
  cached = [
    ...([400, 500, 600, 700] as const).map((weight) => ({ name: SANS, data: load(`Archivo-${weight}.ttf`), weight, style: 'normal' as const })),
    ...([400, 500] as const).map((weight) => ({ name: MONO, data: load(`JetBrainsMono-${weight}.ttf`), weight, style: 'normal' as const })),
  ];
  return cached;
}
