import { describe, expect, it } from 'vitest';

import {
  artifactToWorld,
  normToWorld,
  worldToArtifact,
  worldToNorm,
  type WorldParams,
} from './worldTransform';

/**
 * Unrotated page box 200×100 PDF pts. At 90/270 the rendered (world) box is
 * transposed, so uvW/uvH swap while the unrotated w0/h0 stay put.
 */
function params(rotation: number): WorldParams {
  const transposed = rotation === 90 || rotation === 270;
  return {
    w0: 200,
    h0: 100,
    uvW: transposed ? 100 : 200,
    uvH: transposed ? 200 : 100,
    rotation,
  };
}

const ROTATIONS = [0, 90, 180, 270];

describe('normToWorld / worldToNorm', () => {
  it('round-trips across all rotations', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [0.25, 0.75],
      [0.5, 0.5],
      [0.1, 0.9],
    ];
    for (const rot of ROTATIONS) {
      const p = params(rot);
      for (const [nx, ny] of samples) {
        const [wx, wy] = normToWorld(nx, ny, p);
        const [bx, by] = worldToNorm(wx, wy, p);
        expect(bx).toBeCloseTo(nx, 6);
        expect(by).toBeCloseTo(ny, 6);
      }
    }
  });

  it('maps the normalized top-left corner to the world page top-left at rot 0', () => {
    // norm (0,0) = top-left; world is Y-up so the page top is y = uvH.
    const [wx, wy] = normToWorld(0, 0, params(0));
    expect(wx).toBeCloseTo(0, 6);
    expect(wy).toBeCloseTo(100, 6);
  });

  it('maps the normalized bottom-right corner to the world page bottom-right at rot 0', () => {
    const [wx, wy] = normToWorld(1, 1, params(0));
    expect(wx).toBeCloseTo(200, 6);
    expect(wy).toBeCloseTo(0, 6);
  });

  it('rotates the top-left corner into the world origin at rot 90', () => {
    const [wx, wy] = normToWorld(0, 0, params(90));
    expect(wx).toBeCloseTo(0, 6);
    expect(wy).toBeCloseTo(0, 6);
  });
});

describe('artifactToWorld / worldToArtifact', () => {
  it('round-trips across all rotations', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [200, 100],
      [50, 25],
      [123, 7],
    ];
    for (const rot of ROTATIONS) {
      const p = params(rot);
      for (const [ax, ay] of samples) {
        const [wx, wy] = artifactToWorld(ax, ay, p);
        const [bx, by] = worldToArtifact(wx, wy, p);
        expect(bx).toBeCloseTo(ax, 6);
        expect(by).toBeCloseTo(ay, 6);
      }
    }
  });

  it('is identity (Y-up, same box) at rot 0', () => {
    // Artifact and world share PDF-point scale + Y-up; at rot 0 with uv == box
    // they coincide exactly.
    const p = params(0);
    expect(artifactToWorld(30, 40, p)).toEqual([30, 40]);
  });
});
