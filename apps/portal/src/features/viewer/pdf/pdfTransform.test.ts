import { describe, expect, it } from 'vitest';

import {
  artifactDistance,
  artifactToCss,
  cssToArtifact,
  type PdfTransformParams,
} from './pdfTransform';

const W_BOX = 600;
const H_BOX = 800;

const ROTATIONS = [0, 90, 180, 270] as const;
const SCALES = [1, 2] as const;

/** pdfjs transposes the page rect at 90/270, so pageW/pageH swap there. */
function paramsFor(rotation: number, scale: number): PdfTransformParams {
  const swap = rotation === 90 || rotation === 270;
  return {
    w: W_BOX,
    h: H_BOX,
    pageW: (swap ? H_BOX : W_BOX) * scale,
    pageH: (swap ? W_BOX : H_BOX) * scale,
    rotation,
  };
}

function approx(a: number, b: number, eps = 1e-4): void {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe('artifactToCss / cssToArtifact round-trip', () => {
  const points: Array<[number, number]> = [
    [0, 0],
    [W_BOX, 0],
    [0, H_BOX],
    [W_BOX, H_BOX],
    [123.45, 678.9],
    [300, 400],
  ];
  for (const rotation of ROTATIONS) {
    for (const scale of SCALES) {
      const p = paramsFor(rotation, scale);
      for (const [ax, ay] of points) {
        it(`(${ax},${ay}) at rot ${rotation} scale ${scale}`, () => {
          const [cx, cy] = artifactToCss(ax, ay, p);
          const [rax, ray] = cssToArtifact(cx, cy, p);
          approx(rax, ax);
          approx(ray, ay);
        });
      }
    }
  }
});

describe('center maps to center for every rotation', () => {
  for (const rotation of ROTATIONS) {
    it(`rot ${rotation}`, () => {
      const p = paramsFor(rotation, 1);
      const [cx, cy] = artifactToCss(W_BOX / 2, H_BOX / 2, p);
      approx(cx, p.pageW / 2);
      approx(cy, p.pageH / 2);
    });
  }
});

describe('artifact corners map bijectively onto the four CSS corners', () => {
  for (const rotation of ROTATIONS) {
    it(`rot ${rotation}`, () => {
      const p = paramsFor(rotation, 1);
      const mapped = [
        artifactToCss(0, 0, p),
        artifactToCss(W_BOX, 0, p),
        artifactToCss(0, H_BOX, p),
        artifactToCss(W_BOX, H_BOX, p),
      ]
        .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
        .sort();
      const expected = [
        [0, 0],
        [p.pageW, 0],
        [0, p.pageH],
        [p.pageW, p.pageH],
      ]
        .map(([x, y]) => `${Math.round(x!)},${Math.round(y!)}`)
        .sort();
      expect(mapped).toEqual(expected);
    });
  }
});

describe('rotation 0 orientation (Y-up artifact → Y-down CSS)', () => {
  const p = paramsFor(0, 1);
  it('artifact origin (bottom-left) → CSS bottom-left (0, H)', () => {
    const [cx, cy] = artifactToCss(0, 0, p);
    approx(cx, 0);
    approx(cy, p.pageH);
  });
  it('artifact top-left (0, h) → CSS top-left (0, 0)', () => {
    const [cx, cy] = artifactToCss(0, H_BOX, p);
    approx(cx, 0);
    approx(cy, 0);
  });
});

describe('artifactDistance', () => {
  it('is Euclidean', () => {
    approx(artifactDistance(0, 0, 3, 4), 5);
    approx(artifactDistance(10, 10, 10, 10), 0);
  });
});
