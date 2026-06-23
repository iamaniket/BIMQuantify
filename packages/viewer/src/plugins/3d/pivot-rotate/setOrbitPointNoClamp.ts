/**
 * `setOrbitPoint` without the distance clamp, so click-to-orbit never snaps.
 *
 * camera-controls' `setOrbitPoint` is documented as "set orbit point without
 * moving the camera": it keeps the camera visually fixed by pairing a
 * focalOffset computed from the *true* (unclamped) camera→point distance with
 * `dollyTo(distance)`. But `dollyTo` CLAMPS the orbit radius to
 * `[minDistance, maxDistance]`. When the clicked point is nearer than
 * `minDistance` (kept non-zero so `infinityDolly` fly-through engages) or
 * farther than `maxDistance` (ThatOpen's OrbitMode reverts it to 300 on every
 * projection/mode switch), the clamped radius and the unclamped offset disagree
 * and the camera jumps — backward for near clicks, toward the point for far
 * clicks.
 *
 * Fix: relax the band to `[EPSILON, Infinity]` for this one call so the clamp
 * is a no-op and the true distance is used, then restore the previous limits.
 * Safe because camera-controls never re-clamps the radius per frame (only its
 * unused collision test does), and this viewer's `dollyToCursor` +
 * `infinityDolly` wheel path is itself unclamped (`_dollyToNoClamp`), so a later
 * zoom can't reintroduce the jump. Restoring `minDistance` preserves the
 * fly-through threshold.
 */

/** The subset of camera-controls this helper reads/writes. */
export interface OrbitClampControls {
  setOrbitPoint: (x: number, y: number, z: number) => void;
  minDistance: number;
  maxDistance: number;
}

export function setOrbitPointNoClamp(
  controls: OrbitClampControls,
  x: number,
  y: number,
  z: number,
): void {
  const savedMin = controls.minDistance;
  const savedMax = controls.maxDistance;
  controls.minDistance = Number.EPSILON;
  controls.maxDistance = Infinity;
  try {
    controls.setOrbitPoint(x, y, z);
  } finally {
    controls.minDistance = savedMin;
    controls.maxDistance = savedMax;
  }
}
