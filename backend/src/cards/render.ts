import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { loadFonts } from './fonts.js';
import type { El } from './h.js';

/** Element tree → PNG buffer (satori lays out to SVG, resvg rasterizes). */
export async function renderPng(el: El, width: number, height: number): Promise<Buffer> {
  const svgText = await satori(el as Parameters<typeof satori>[0], { width, height, fonts: loadFonts() });
  return new Resvg(svgText, { fitTo: { mode: 'width', value: width } }).render().asPng();
}
