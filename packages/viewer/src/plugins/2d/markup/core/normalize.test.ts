import { describe, expect, it } from 'vitest';

import { artifactToNorm, normCentroid, normToArtifact, pointsToArtifact, pointsToNorm } from './normalize.js';

describe('markup normalize', () => {
  const W = 600;
  const H = 800;

  it('flips Y between artifact (Y-up) and normalized (Y-down)', () => {
    // Artifact bottom-left origin -> normalized top-left origin.
    expect(artifactToNorm(0, 0, W, H)).toEqual([0, 1]); // bottom-left
    expect(artifactToNorm(W, H, W, H)).toEqual([1, 0]); // top-right
    expect(artifactToNorm(W / 2, H / 2, W, H)).toEqual([0.5, 0.5]); // centre
  });

  it('round-trips artifact -> norm -> artifact', () => {
    const pts: [number, number][] = [
      [123, 456],
      [0, 0],
      [W, H],
      [42, 7],
    ];
    for (const [ax, ay] of pts) {
      const [nx, ny] = artifactToNorm(ax, ay, W, H);
      const [bx, by] = normToArtifact(nx, ny, W, H);
      expect(bx).toBeCloseTo(ax, 6);
      expect(by).toBeCloseTo(ay, 6);
    }
  });

  it('handles a degenerate zero-size box without NaN', () => {
    expect(artifactToNorm(10, 10, 0, 0)).toEqual([0, 0]);
  });

  it('computes the normalized centroid', () => {
    expect(normCentroid([[0, 0], [1, 1]])).toEqual({ x: 0.5, y: 0.5 });
    expect(normCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it('maps whole point lists both directions', () => {
    const norm: [number, number][] = [[0.1, 0.2], [0.8, 0.9]];
    const artifact = pointsToArtifact(norm, W, H);
    const back = pointsToNorm(artifact, W, H);
    for (let i = 0; i < norm.length; i += 1) {
      expect(back[i]![0]).toBeCloseTo(norm[i]![0], 6);
      expect(back[i]![1]).toBeCloseTo(norm[i]![1], 6);
    }
  });
});
