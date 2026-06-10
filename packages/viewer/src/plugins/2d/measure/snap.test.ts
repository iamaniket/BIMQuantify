import { describe, expect, it } from 'vitest';

import type { Line } from './geometryTypes';

import { buildPageSnapData, findNearestSnap, type SnapProjector } from './snap';
import { artifactToCss, type PdfTransformParams } from './transform';

const L = (a: number, b: number, c: number, d: number): Line => [a, b, c, d];

/** Identity-ish params: artifact (ax,ay) → CSS (ax, 100 − ay) at rot 0. */
function idParams(): PdfTransformParams {
  return { w: 100, h: 100, pageW: 100, pageH: 100, rotation: 0 };
}

/** Projector mirroring the old CSS-space behaviour, for the tests. */
function cssProjector(params: PdfTransformParams): SnapProjector {
  return (ax, ay) => artifactToCss(ax, ay, params);
}

describe('buildPageSnapData', () => {
  it('dedupes shared endpoints', () => {
    const data = buildPageSnapData([L(0, 0, 10, 0), L(10, 0, 10, 10)]);
    // (0,0), (10,0)×2 collapse, (10,10) → 3 unique endpoints
    expect(data.endpoints).toHaveLength(3);
  });

  it('drops degenerate (zero-length) segments', () => {
    const data = buildPageSnapData([L(5, 5, 5, 5), L(0, 0, 10, 0)]);
    expect(data.segments).toHaveLength(1);
  });

  it('finds the crossing point of two intersecting segments', () => {
    const data = buildPageSnapData([L(0, 0, 10, 10), L(0, 10, 10, 0)]);
    expect(data.intersections).toHaveLength(1);
    const [hit] = data.intersections;
    expect(hit).toBeDefined();
    expect(Math.abs(hit!.ax - 5)).toBeLessThan(1e-6);
    expect(Math.abs(hit!.ay - 5)).toBeLessThan(1e-6);
  });

  it('does not emit an intersection for parallel segments', () => {
    const data = buildPageSnapData([L(0, 0, 10, 0), L(0, 5, 10, 5)]);
    expect(data.intersections).toHaveLength(0);
  });
});

describe('findNearestSnap', () => {
  it('returns the nearest point within threshold', () => {
    const params = idParams();
    const data = buildPageSnapData([L(10, 0, 10, 10), L(40, 40, 60, 60)]);
    const [cx, cy] = artifactToCss(10, 0, params);
    const hit = findNearestSnap(data, { x: cx, y: cy }, cssProjector(params), 10);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.ax - 10)).toBeLessThan(1e-6);
    expect(Math.abs(hit!.ay - 0)).toBeLessThan(1e-6);
    expect(hit!.distance).toBeLessThan(1e-6);
  });

  it('prefers an endpoint over a closer intersection (priority)', () => {
    const params = idParams();
    // Endpoint at (50,50); a crossing at (52,50) that is raw-closer to the cursor.
    const data = buildPageSnapData([
      L(50, 50, 50, 60), // endpoint (50,50)
      L(48, 50, 56, 50), // horizontal through (52,50)
      L(52, 46, 52, 54), // vertical through (52,50)
    ]);
    // Cursor sits on the intersection's projection, 2px from the endpoint.
    const hit = findNearestSnap(data, { x: 52, y: 50 }, cssProjector(params), 10);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe('endpoint');
    expect(Math.abs(hit!.ax - 50)).toBeLessThan(1e-6);
    expect(Math.abs(hit!.ay - 50)).toBeLessThan(1e-6);
  });

  it('returns null when nothing is within threshold', () => {
    const params = idParams();
    const data = buildPageSnapData([L(10, 10, 20, 20)]);
    const hit = findNearestSnap(data, { x: 90, y: 90 }, cssProjector(params), 5);
    expect(hit).toBeNull();
  });
});
