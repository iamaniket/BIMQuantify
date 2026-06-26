import { describe, expect, it } from 'vitest';

import { pdfToPlan, planToPdf, type SheetTransform } from './sheetTransform';

const IDENTITY: SheetTransform = { scale: 1, rotationRad: 0, offsetX: 0, offsetY: 0 };

function close(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

describe('pdfToPlan', () => {
  // The PDF side is Y-down normalized; plan space is Y-up. pdfToPlan flips the
  // PDF Y (`v → 1 − v`) before the similarity, so the identity transform is a
  // pure vertical flip — NOT the identity map. This is the handedness contract
  // (see sheetTransform.ts HANDEDNESS); the matching flip lives in the capture
  // path (useSheetCalibration) so the server's pure similarity stays valid.
  it('identity flips the PDF Y (v → 1 − v)', () => {
    const out = pdfToPlan({ x: 0.4, y: 0.7 }, IDENTITY);
    expect(close(out.x, 0.4)).toBe(true);
    expect(close(out.y, 0.3)).toBe(true);
  });

  it('applies pure translation (on the flipped point)', () => {
    // pt.y = 1 → flipped v = 0, so the point is (0,0) before translation.
    const out = pdfToPlan({ x: 0, y: 1 }, { ...IDENTITY, offsetX: 5, offsetY: 3 });
    expect(close(out.x, 5)).toBe(true);
    expect(close(out.y, 3)).toBe(true);
  });

  it('applies +90deg rotation (on the flipped point)', () => {
    // pt = (1,1) → flipped (1,0); R(+90)·(1,0) = (0,1).
    const out = pdfToPlan({ x: 1, y: 1 }, { ...IDENTITY, rotationRad: Math.PI / 2 });
    expect(close(out.x, 0)).toBe(true);
    expect(close(out.y, 1)).toBe(true);
  });

  it('applies uniform scale (on the flipped point)', () => {
    const out = pdfToPlan({ x: 1, y: 1 }, { ...IDENTITY, scale: 2 });
    expect(close(out.x, 2)).toBe(true);
    expect(close(out.y, 0)).toBe(true);
  });

  it('applies a combined scale + rotation + translation', () => {
    // pt = (1,1) → flipped (1,0); scale 2, +90deg, translate (10,-5):
    //   2·R(90)·(1,0) + (10,-5) = 2·(0,1) + (10,-5) = (10,-3).
    const t: SheetTransform = { scale: 2, rotationRad: Math.PI / 2, offsetX: 10, offsetY: -5 };
    const out = pdfToPlan({ x: 1, y: 1 }, t);
    expect(close(out.x, 10, 1e-9)).toBe(true);
    expect(close(out.y, -3, 1e-9)).toBe(true);
  });
});

describe('planToPdf', () => {
  it('identity flips back to PDF Y-down (the inverse of pdfToPlan)', () => {
    const out = planToPdf({ x: 0.4, y: 0.3 }, IDENTITY);
    expect(close(out.x, 0.4)).toBe(true);
    expect(close(out.y, 0.7)).toBe(true);
  });

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

  it('inverts a pure rotation (and flips Y back)', () => {
    // plan (0,1) → R(−90)·(0,1) = (1,0) → flip Y → (1,1).
    const t: SheetTransform = { ...IDENTITY, rotationRad: Math.PI / 2 };
    const out = planToPdf({ x: 0, y: 1 }, t);
    expect(close(out.x, 1, 1e-9)).toBe(true);
    expect(close(out.y, 1, 1e-9)).toBe(true);
  });

  it('a 3rd point off the control line is NOT mirrored (handedness regression)', () => {
    // Two PDF control picks (already flipped to plan convention by the caller)
    // map to two plan points; the solved transform here is scale 1, no rotation,
    // translate by +1 in plan-Y. A 3rd point must land on the correct side — the
    // bug was that a reflection-free fit mirrored everything off the control line.
    const t: SheetTransform = { scale: 1, rotationRad: 0, offsetX: 0, offsetY: 1 };
    // pt = (0.5, 0.2) → flip v = 0.8 → (0.5, 0.8) + (0,1) = (0.5, 1.8).
    const out = pdfToPlan({ x: 0.5, y: 0.2 }, t);
    expect(close(out.x, 0.5)).toBe(true);
    expect(close(out.y, 1.8)).toBe(true);
  });
});
