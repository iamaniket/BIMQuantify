import type { AlignedSheet } from '@/lib/api/schemas';

/**
 * The 2-point similarity that pins an aligned PDF sheet onto the minimap plan
 * space. Structurally identical to `@bimdossier/viewer`'s `SheetTransform` (the
 * minimap's `setSheetTransform`/`calibrate` accept it), declared here so the
 * portal stays decoupled from the viewer build for the substitution path.
 */
export type SheetTransform = {
  scale: number;
  rotationRad: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Map a calibrated `aligned_sheets` row to a `SheetTransform`, or `null` when the
 * sheet isn't calibrated (the solved fields are nullable until `/calibrate`).
 */
export function toSheetTransform(sheet: AlignedSheet | null | undefined): SheetTransform | null {
  if (
    !sheet ||
    !sheet.is_calibrated ||
    sheet.scale == null ||
    sheet.rotation_rad == null ||
    sheet.offset_x == null ||
    sheet.offset_y == null
  ) {
    return null;
  }
  return {
    scale: sheet.scale,
    rotationRad: sheet.rotation_rad,
    offsetX: sheet.offset_x,
    offsetY: sheet.offset_y,
  };
}
