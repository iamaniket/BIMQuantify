import { describe, expect, it } from 'vitest';

import {
  cardinalToRotation,
  pointerAngleDeg,
  rotationLabel,
  rotationToCardinal,
  shortestAngleDelta,
  snapToQuarter,
  type Cardinal,
} from './geometry';

describe('cardinalToRotation / rotationToCardinal', () => {
  it('maps cardinals to quarter-turns', () => {
    expect(cardinalToRotation('N')).toBe(0);
    expect(cardinalToRotation('E')).toBe(90);
    expect(cardinalToRotation('S')).toBe(180);
    expect(cardinalToRotation('W')).toBe(270);
  });
  it('round-trips', () => {
    for (const c of ['N', 'E', 'S', 'W'] as Cardinal[]) {
      expect(rotationToCardinal(cardinalToRotation(c))).toBe(c);
    }
  });
});

describe('pointerAngleDeg', () => {
  const cx = 100;
  const cy = 100;
  it('up is 0°', () => {
    expect(pointerAngleDeg(100, 40, cx, cy)).toBeCloseTo(0, 6);
  });
  it('right is 90° (E)', () => {
    expect(pointerAngleDeg(160, 100, cx, cy)).toBeCloseTo(90, 6);
  });
  it('down is 180° (S)', () => {
    expect(pointerAngleDeg(100, 160, cx, cy)).toBeCloseTo(180, 6);
  });
  it('left is 270° (W)', () => {
    expect(pointerAngleDeg(40, 100, cx, cy)).toBeCloseTo(270, 6);
  });
  it('up-right diagonal is 45°', () => {
    expect(pointerAngleDeg(160, 40, cx, cy)).toBeCloseTo(45, 6);
  });
  it('always returns [0, 360)', () => {
    expect(pointerAngleDeg(40, 99, cx, cy)).toBeGreaterThanOrEqual(0);
    expect(pointerAngleDeg(40, 99, cx, cy)).toBeLessThan(360);
  });
});

describe('snapToQuarter', () => {
  it('snaps to the nearest 90°', () => {
    expect(snapToQuarter(0)).toBe(0);
    expect(snapToQuarter(44)).toBe(0);
    expect(snapToQuarter(45)).toBe(90);
    expect(snapToQuarter(47)).toBe(90);
    expect(snapToQuarter(134)).toBe(90);
    expect(snapToQuarter(135)).toBe(180);
    expect(snapToQuarter(314)).toBe(270);
    expect(snapToQuarter(359)).toBe(0);
    expect(snapToQuarter(360)).toBe(0);
  });
  it('handles negatives and values past a full turn', () => {
    expect(snapToQuarter(-10)).toBe(0);
    expect(snapToQuarter(-90)).toBe(270);
    expect(snapToQuarter(370)).toBe(0);
    expect(snapToQuarter(450)).toBe(90);
  });
});

describe('shortestAngleDelta', () => {
  it('takes the short way across the seam', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });
  it('is 0 for equal angles', () => {
    expect(shortestAngleDelta(90, 90)).toBe(0);
  });
  it('resolves the half-turn to +180', () => {
    expect(shortestAngleDelta(0, 180)).toBe(180);
  });
});

describe('rotationLabel', () => {
  it('appends the degree sign', () => {
    expect(rotationLabel(0)).toBe('0°');
    expect(rotationLabel(90)).toBe('90°');
    expect(rotationLabel(270)).toBe('270°');
  });
});
