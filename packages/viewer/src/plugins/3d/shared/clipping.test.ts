import { describe, expect, it } from 'vitest';

import { isPointClipped, type SectionPlaneData } from './clipping';

/** Plane through the origin whose normal points along +X. */
const planeX = (active: boolean): SectionPlaneData => ({
  normal: { x: 1, y: 0, z: 0 },
  point: { x: 0, y: 0, z: 0 },
  active,
});

describe('isPointClipped', () => {
  it('is never clipped with no planes', () => {
    expect(isPointClipped({ x: -5, y: 0, z: 0 }, [])).toBe(false);
  });

  it('ignores inactive planes even when the point is behind them', () => {
    expect(isPointClipped({ x: -1, y: 0, z: 0 }, [planeX(false)])).toBe(false);
  });

  it('clips a point in the negative half-space (behind the cut)', () => {
    expect(isPointClipped({ x: -1, y: 0, z: 0 }, [planeX(true)])).toBe(true);
  });

  it('keeps a point in the positive half-space (in front of the cut)', () => {
    expect(isPointClipped({ x: 1, y: 0, z: 0 }, [planeX(true)])).toBe(false);
  });

  it('treats a point exactly on the plane as not clipped (strict < 0)', () => {
    expect(isPointClipped({ x: 0, y: 0, z: 0 }, [planeX(true)])).toBe(false);
  });

  it('clips when ANY active plane rejects the point', () => {
    const planeYDown: SectionPlaneData = {
      normal: { x: 0, y: 1, z: 0 },
      point: { x: 0, y: 10, z: 0 },
      active: true,
    };
    // In front of planeX (x=5) but below planeY's coplanar point (y=0 < 10).
    expect(isPointClipped({ x: 5, y: 0, z: 0 }, [planeX(true), planeYDown])).toBe(true);
  });

  it('respects a non-axis-aligned normal', () => {
    const diag: SectionPlaneData = {
      normal: { x: 1, y: 1, z: 0 },
      point: { x: 0, y: 0, z: 0 },
      active: true,
    };
    // (pt - point) · normal = (-1)(1) + (-1)(1) = -2 < 0 → clipped.
    expect(isPointClipped({ x: -1, y: -1, z: 0 }, [diag])).toBe(true);
    // (1)(1) + (1)(1) = 2 > 0 → kept.
    expect(isPointClipped({ x: 1, y: 1, z: 0 }, [diag])).toBe(false);
  });
});
