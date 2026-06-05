import { describe, expect, it } from 'vitest';

import {
  angleDegrees,
  centroid,
  formatAngle,
  formatArea,
  formatDistance,
  polygonArea,
  type Pt,
} from './math';

describe('angleDegrees', () => {
  it('right angle is 90°', () => {
    expect(angleDegrees([1, 0], [0, 0], [0, 1])).toBeCloseTo(90, 6);
  });
  it('straight line is 180°', () => {
    expect(angleDegrees([1, 0], [0, 0], [-1, 0])).toBeCloseTo(180, 6);
  });
  it('coincident arms is 0°', () => {
    // acos() near 1 carries ~1e-6 float noise — the value is geometrically 0.
    expect(angleDegrees([1, 1], [0, 0], [1, 1])).toBeCloseTo(0, 4);
  });
  it('45° arms', () => {
    expect(angleDegrees([1, 0], [0, 0], [1, 1])).toBeCloseTo(45, 6);
  });
  it('degenerate (zero-length arm) returns 0', () => {
    expect(angleDegrees([0, 0], [0, 0], [1, 0])).toBe(0);
  });
});

describe('polygonArea (shoelace)', () => {
  it('unit square = 1', () => {
    expect(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1, 6);
  });
  it('is winding-independent (clockwise)', () => {
    const cw: Pt[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(polygonArea(cw)).toBeCloseTo(1, 6);
  });
  it('triangle = 6', () => {
    expect(polygonArea([[0, 0], [4, 0], [0, 3]])).toBeCloseTo(6, 6);
  });
  it('returns 0 for fewer than 3 points', () => {
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('centroid', () => {
  it('averages vertices', () => {
    expect(centroid([[0, 0], [2, 0], [2, 2], [0, 2]])).toEqual([1, 1]);
  });
});

describe('label formatters', () => {
  it('distance in points', () => {
    expect(formatDistance(2.5)).toBe('2.5 pt');
  });
  it('angle in degrees', () => {
    expect(formatAngle(90)).toBe('90.0°');
  });
  it('small area keeps a decimal', () => {
    expect(formatArea(12.5)).toBe('12.5 pt²');
  });
  it('large area rounds to an integer', () => {
    expect(formatArea(48000)).toBe(`${(48000).toLocaleString()} pt²`);
  });
});
