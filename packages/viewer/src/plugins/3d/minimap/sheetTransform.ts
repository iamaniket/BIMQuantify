/**
 * The 2-point similarity transform that pins an aligned PDF sheet onto a model.
 *
 * Composes ON TOP of `planCoords.ts` — it maps between PDF page space and the
 * minimap's *plan* space, leaving `planToViewer`/`viewerToPlan` (and their single
 * Y-up negation) untouched. The full chains the minimap runs when an aligned
 * sheet is active:
 *
 *   PDF pick  → pdfToPlan → planToViewer(elevation) → world   (place / navigate)
 *   world     → viewerToPlan → planToPdf            → PDF      (you-are-here / pins)
 *
 * The transform itself is solved server-side (`/aligned-sheets/{id}/calibrate`,
 * mirroring `bimdossier_api.alignment.similarity`) and stored as
 * `{ scale, rotation_rad, offset_x, offset_y }`; map those onto `SheetTransform`.
 *
 * HANDEDNESS — the PDF side is normalized [0,1] page coords (top-left origin,
 * Y-DOWN) while plan space is Y-UP (`viewerToPlan` negates plan-Y). The two differ
 * by a vertical reflection, which a *pure* similarity (det = scale² > 0) cannot
 * represent. So we flip the PDF Y to plan convention (`v → 1 − v`) on the PDF side
 * of BOTH functions — this is the `(u, 1 − v)` source contract documented in
 * `bimdossier_api.alignment.similarity::solve_similarity`. The capture path
 * (`useSheetCalibration`) applies the same flip before POSTing the control points;
 * the two MUST stay in lockstep. `planToPdf` returns Y-down again, so the render
 * path (`camera-pose`'s `1 - hereY`, `entity-marker-2d`, `document:pick`) is
 * unchanged.
 */

export type SheetTransform = {
  scale: number;
  rotationRad: number;
  offsetX: number;
  offsetY: number;
};

export type Vec2 = { x: number; y: number };

/**
 * Map a PDF-page point (normalized, Y-down) to plan space:
 * `plan = scale·R(θ)·(u, 1 − v) + offset`. The `v → 1 − v` flip reconciles the
 * Y-down PDF page with Y-up plan space (see the file header HANDEDNESS note).
 */
export function pdfToPlan(pt: Vec2, t: SheetTransform): Vec2 {
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  const vx = pt.x;
  const vy = 1 - pt.y; // PDF Y-down → plan Y-up before the similarity
  return {
    x: t.scale * (cos * vx - sin * vy) + t.offsetX,
    y: t.scale * (sin * vx + cos * vy) + t.offsetY,
  };
}

/** Inverse: map a plan-space point back to PDF-page coords (normalized, Y-down). */
export function planToPdf(pt: Vec2, t: SheetTransform): Vec2 {
  const invScale = 1 / t.scale;
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  // (u, 1 − v) = (1/scale)·R(−θ)·(plan − offset); then flip back to PDF Y-down.
  const dx = pt.x - t.offsetX;
  const dy = pt.y - t.offsetY;
  return {
    x: invScale * (cos * dx + sin * dy),
    y: 1 - invScale * (-sin * dx + cos * dy),
  };
}
