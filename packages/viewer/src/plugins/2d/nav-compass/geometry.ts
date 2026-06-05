/**
 * Pure math for the nav-compass widget — no DOM, no pdf.js. The only
 * unit-tested surface (mirrors `plugins/2d/measure/math.ts`). All angles are
 * **degrees, clockwise, 0 = up (12 o'clock)** so they line up with both CSS
 * `rotate()` and pdf.js's clockwise page rotation.
 */

import type { DocumentRotation } from '../../../pdf-core/documentTypes.js';

/** The four fixed screen-frame snap targets. */
export type Cardinal = 'N' | 'E' | 'S' | 'W';

const CARDINAL_ROTATION: Record<Cardinal, DocumentRotation> = {
  N: 0,
  E: 90,
  S: 180,
  W: 270,
};

/** Cardinal marker → absolute page rotation. N=0, E=90, S=180, W=270. */
export function cardinalToRotation(c: Cardinal): DocumentRotation {
  return CARDINAL_ROTATION[c];
}

/** Inverse of {@link cardinalToRotation}: which cardinal a rotation lands on. */
export function rotationToCardinal(r: DocumentRotation): Cardinal {
  switch (r) {
    case 90:
      return 'E';
    case 180:
      return 'S';
    case 270:
      return 'W';
    default:
      return 'N';
  }
}

/**
 * Pointer position → angle in degrees, clockwise, 0 = up. `cx`/`cy` is the ring
 * centre in the same coordinate space as `px`/`py`. Returns `[0, 360)`.
 * Mirror of `ViewCubeWidget.ringAngleFromEvent` (radians) converted to degrees.
 * up → 0, right → 90 (E), down → 180 (S), left → 270 (W).
 */
export function pointerAngleDeg(px: number, py: number, cx: number, cy: number): number {
  const rad = Math.atan2(px - cx, -(py - cy));
  const deg = (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Nearest quarter-turn of an arbitrary angle → a {@link DocumentRotation}. */
export function snapToQuarter(angleDeg: number): DocumentRotation {
  const snapped = ((Math.round(angleDeg / 90) * 90) % 360 + 360) % 360;
  return snapped as DocumentRotation;
}

/**
 * Smallest signed delta from `fromDeg` to `toDeg`, in `(-180, 180]`. Lets a drag
 * accumulate per-move without jumping at the 359°→0° seam.
 */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Locale-neutral readout, e.g. `rotationLabel(90) === '90°'`. */
export function rotationLabel(r: DocumentRotation): string {
  return `${String(r)}°`;
}
