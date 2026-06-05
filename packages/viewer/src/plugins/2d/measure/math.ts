/**
 * Pure measurement math + label formatting (no three.js), shared by the measure
 * plugin and its unit tests. All inputs are artifact-space (PDF points), so
 * results are scale/rotation-invariant.
 */

export type Pt = [number, number];

/** Interior angle (degrees) at vertex `v` between the arms to `a` and `b`. */
export function angleDegrees(a: Pt, v: Pt, b: Pt): number {
  const ax = a[0] - v[0];
  const ay = a[1] - v[1];
  const bx = b[0] - v[0];
  const by = b[1] - v[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Shoelace polygon area (PDF points²) — sign-independent. */
export function polygonArea(points: Pt[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(sum) / 2;
}

/** Vertex average — used to place an area label. */
export function centroid(points: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const n = points.length || 1;
  return [x / n, y / n];
}

export function formatDistance(pt: number): string {
  return `${pt.toFixed(1)} pt`;
}

export function formatAngle(deg: number): string {
  return `${deg.toFixed(1)}°`;
}

export function formatArea(pt2: number): string {
  const v = pt2 >= 100 ? Math.round(pt2).toLocaleString() : pt2.toFixed(1);
  return `${v} pt²`;
}
