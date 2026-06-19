import { describe, expect, it } from 'vitest';

import {
  annotationCentroid,
  clientToNorm,
  distSqToSegment,
  normBBox,
  normToPx,
  strokeWidthToPx,
} from './coords.js';
import { REFERENCE_EXTENT, type Annotation2D } from './types.js';

describe('clientToNorm / normToPx', () => {
  it('round-trips the centre of a rect', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    const norm = clientToNorm(300, 150, rect);
    expect(norm[0]).toBeCloseTo(0.5);
    expect(norm[1]).toBeCloseTo(0.5);
    const px = normToPx(norm, rect.width, rect.height);
    expect(px[0]).toBeCloseTo(200);
    expect(px[1]).toBeCloseTo(100);
  });

  it('clamps points outside the image box to 0..1', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(clientToNorm(-50, 250, rect)).toEqual([0, 1]);
    expect(clientToNorm(50, 50, rect)).toEqual([0.5, 0.5]);
  });

  it('is resolution-independent (same norm renders proportionally at any size)', () => {
    const norm: [number, number] = [0.25, 0.75];
    const small = normToPx(norm, 200, 100);
    const large = normToPx(norm, 800, 400);
    expect(large[0] / small[0]).toBeCloseTo(4);
    expect(large[1] / small[1]).toBeCloseTo(4);
  });
});

describe('strokeWidthToPx', () => {
  it('equals the authored value at the reference extent', () => {
    expect(strokeWidthToPx(6, REFERENCE_EXTENT)).toBe(6);
  });
  it('scales linearly with the longest edge', () => {
    expect(strokeWidthToPx(6, REFERENCE_EXTENT * 2)).toBe(12);
    expect(strokeWidthToPx(6, REFERENCE_EXTENT / 2)).toBe(3);
  });
});

describe('normBBox / annotationCentroid', () => {
  it('computes a bbox regardless of point order', () => {
    const b = normBBox([
      [0.6, 0.1],
      [0.2, 0.3],
    ]);
    expect(b.x).toBeCloseTo(0.2);
    expect(b.y).toBeCloseTo(0.1);
    expect(b.w).toBeCloseTo(0.4);
    expect(b.h).toBeCloseTo(0.2);
  });

  it('centroid of a full-image rect is the centre', () => {
    const a: Annotation2D = {
      id: '1',
      tool: 'rect',
      points: [
        [0, 0],
        [1, 1],
      ],
      color: '#ef4444',
      strokeWidth: 6,
    };
    expect(annotationCentroid(a)).toEqual([0.5, 0.5]);
  });
});

describe('distSqToSegment', () => {
  it('measures perpendicular distance to a segment', () => {
    expect(distSqToSegment([0, 1], [0, 0], [2, 0])).toBeCloseTo(1);
  });
  it('clamps to the nearest endpoint past the segment ends', () => {
    expect(distSqToSegment([5, 0], [0, 0], [2, 0])).toBeCloseTo(9);
  });
});
