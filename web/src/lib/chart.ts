/** Hand-rolled SVG path helpers (same maths as the design's path()). */

export interface Domain {
  min: number;
  max: number;
}

export function domainOf(...series: number[][]): Domain {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

export function linePath(vals: number[], w: number, h: number, pad = 0, domain?: Domain): string {
  if (vals.length === 0) return '';
  const d = domain ?? domainOf(vals);
  const span = d.max - d.min || 1;
  const n = vals.length;
  return vals
    .map((v, i) => {
      const x = n === 1 ? w : (i / (n - 1)) * w;
      const y = pad + (1 - (v - d.min) / span) * (h - pad * 2);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    })
    .join(' ');
}

export function areaPath(vals: number[], w: number, h: number, pad = 0, domain?: Domain): string {
  const line = linePath(vals, w, h, pad, domain);
  if (!line) return '';
  return `${line} L${w} ${h} L0 ${h} Z`;
}

/** Step path for the high-water mark: flat segments, vertical jumps where the mark moves up. */
export function stepPath(vals: number[], w: number, h: number, pad = 0, domain?: Domain): string {
  if (vals.length === 0) return '';
  const d = domain ?? domainOf(vals);
  const span = d.max - d.min || 1;
  const n = vals.length;
  const y = (v: number) => (pad + (1 - (v - d.min) / span) * (h - pad * 2)).toFixed(1);
  const x = (i: number) => (n === 1 ? w : (i / (n - 1)) * w).toFixed(1);
  let out = `M0 ${y(vals[0])}`;
  for (let i = 1; i < n; i++) {
    if (vals[i] !== vals[i - 1]) out += ` L${x(i)} ${y(vals[i - 1])} L${x(i)} ${y(vals[i])}`;
  }
  out += ` L${w} ${y(vals[n - 1])}`;
  return out;
}
