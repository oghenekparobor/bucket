/**
 * Minimal element factory for satori (no React needed): `h('div', style, ...children)` builds the
 * `{ type, props }` objects satori renders. Every div with more than one child is a flex container.
 */
export type Style = Record<string, string | number>;

export interface El {
  type: string;
  props: { style?: Style; children?: Child | Child[]; [attr: string]: unknown };
}

export type Child = El | string | null | false;

export function h(type: string, style: Style = {}, ...children: Child[]): El {
  const kids = children.filter((c): c is El | string => c !== null && c !== false);
  const needsFlex = type === 'div' && !('display' in style);
  return { type, props: { style: needsFlex ? { display: 'flex', ...style } : style, children: kids.length === 1 ? kids[0] : kids } };
}

/** An SVG element with attributes (satori supports inline <svg>/<path>/<rect>). */
export function svg(width: number, height: number, viewBox: string, ...children: El[]): El {
  return { type: 'svg', props: { width, height, viewBox, children } };
}

export function path(d: string, fill: string): El {
  return { type: 'path', props: { d, fill } };
}

export function rect(x: number, y: number, width: number, height: number, fill: string): El {
  return { type: 'rect', props: { x, y, width, height, fill } };
}

/** Design tokens from design/Bucket.dc.html. */
export const C = {
  bg: '#EFEEEA',
  card: '#FCFBF7',
  ink: '#1C1C1A',
  yellow: '#E8DF4A',
  grey: '#8B8A85',
  greyDark: '#6B6A66',
  line: '#DCDAD4',
  track: '#EAE8E3',
  body: '#3C3C38',
} as const;

export const SANS = 'Archivo';
export const MONO = 'JetBrains Mono';
