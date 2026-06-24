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
 * mirroring `bimstitch_api.alignment.similarity`) and stored as
 * `{ scale, rotation_rad, offset_x, offset_y }`; map those onto `SheetTransform`.
 */

export type SheetTransform = {
  scale: number;
  rotationRad: number;
  offsetX: number;
  offsetY: number;
};

export type Vec2 = { x: number; y: number };

/** Map a PDF-page point to plan space: `plan = scale·R(θ)·pdf + offset`. */
export function pdfToPlan(pt: Vec2, t: SheetTransform): Vec2 {
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return {
    x: t.scale * (cos * pt.x - sin * pt.y) + t.offsetX,
    y: t.scale * (sin * pt.x + cos * pt.y) + t.offsetY,
  };
}

/** Inverse: map a plan-space point back to PDF-page coords. */
export function planToPdf(pt: Vec2, t: SheetTransform): Vec2 {
  const invScale = 1 / t.scale;
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  // pdf = (1/scale)·R(−θ)·(plan − offset)
  const dx = pt.x - t.offsetX;
  const dy = pt.y - t.offsetY;
  return {
    x: invScale * (cos * dx + sin * dy),
    y: invScale * (-sin * dx + cos * dy),
  };
}
