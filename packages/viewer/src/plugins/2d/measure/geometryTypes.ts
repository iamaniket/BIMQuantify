/**
 * Minimal in-package mirror of the portal's PDF vector-geometry shape
 * (`apps/portal/src/lib/api/schemas/geometry.ts`). The measure plugin only needs
 * the line list (for snapping) and the page-box dims; the portal's richer Zod
 * `PageGeometry` is structurally assignable to {@link PageGeometryLike}, so the
 * portal can feed it straight in via the `measure.setPageGeometry` command.
 *
 * Coordinates are PDF points, Y-up, bottom-left origin, box-relative.
 */

/** `[sx, sy, ex, ey]` or `[sx, sy, ex, ey, strokeWidth]` (page points). */
export type Line =
  | [number, number, number, number]
  | [number, number, number, number, number];

export interface PageGeometryLike {
  /** Page-box width in PDF points. */
  w: number;
  /** Page-box height in PDF points. */
  h: number;
  /** Intrinsic page rotation in degrees, if any. */
  rot?: number;
  /** Drawing segments in artifact space (used for snapping). */
  l: Line[];
}
