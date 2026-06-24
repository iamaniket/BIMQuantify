import { describe, expect, it } from 'vitest';

import { pdfToPlan, planToPdf, type SheetTransform } from './sheetTransform';

const IDENTITY: SheetTransform = { scale: 1, rotationRad: 0, offsetX: 0, offsetY: 0 };

function close(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

describe('pdfToPlan', () => {
  it('identity maps a point to itself', () => {
    const out = pdfToPlan({ x: 0.4, y: 0.7 }, IDENTITY);
    expect(close(out.x, 0.4)).toBe(true);
    expect(close(out.y, 0.7)).toBe(true);
  });

  it('applies pure translation', () => {
    const out = pdfToPlan({ x: 0, y: 0 }, { ...IDENTITY, offsetX: 5, offsetY: 3 });
    expect(close(out.x, 5)).toBe(true);
    expect(close(out.y, 3)).toBe(true);
  });

  it('applies +90deg rotation', () => {
    const out = pdfToPlan({ x: 1, y: 0 }, { ...IDENTITY, rotationRad: Math.PI / 2 });
    expect(close(out.x, 0)).toBe(true);
    expect(close(out.y, 1)).toBe(true);
  });

  it('applies uniform scale', () => {
    const out = pdfToPlan({ x: 1, y: 0 }, { ...IDENTITY, scale: 2 });
    expect(close(out.x, 2)).toBe(true);
    expect(close(out.y, 0)).toBe(true);
  });

  it('applies a combined scale + rotation + translation', () => {
    // scale 2, +90deg, translate (10, -5): (1,0) -> 2·(0,1) + (10,-5) = (10,-3).
    const t: SheetTransform = { scale: 2, rotationRad: Math.PI / 2, offsetX: 10, offsetY: -5 };
    const out = pdfToPlan({ x: 1, y: 0 }, t);
    expect(close(out.x, 10, 1e-9)).toBe(true);
    expect(close(out.y, -3, 1e-9)).toBe(true);
  });
});

describe('planToPdf', () => {
  it('round-trips with pdfToPlan for arbitrary transforms and points', () => {
    const t: SheetTransform = { scale: 2.5, rotationRad: 0.7, offsetX: 12, offsetY: -4 };
    for (const p of [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.9 },
      { x: -3.2, y: 7.1 },
    ]) {
      const round = planToPdf(pdfToPlan(p, t), t);
      expect(close(round.x, p.x, 1e-6)).toBe(true);
      expect(close(round.y, p.y, 1e-6)).toBe(true);
    }
  });

  it('inverts a pure rotation', () => {
    const t: SheetTransform = { ...IDENTITY, rotationRad: Math.PI / 2 };
    const out = planToPdf({ x: 0, y: 1 }, t);
    expect(close(out.x, 1, 1e-9)).toBe(true);
    expect(close(out.y, 0, 1e-9)).toBe(true);
  });
});
