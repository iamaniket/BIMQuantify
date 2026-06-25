/**
 * Renderer-agnostic data model for 2D annotations — runtime-free so any app
 * (portal, viewer-embed, future React Native) can import the types directly.
 *
 * This is the SINGLE source of truth for the annotation shape model. The 3D/PDF
 * viewer (`@bimdossier/viewer`) re-exports {@link Annotation2D} / {@link MarkupTool}
 * / {@link MarkupStyle} from here so image markup and PDF markup speak one model.
 *
 * Coordinate convention for {@link Annotation2D.points}: NORMALIZED to the image
 * (or page) box, range `0..1`, **top-left origin, Y-down** — identical to how
 * findings persist `anchor_x` / `anchor_y`. This is resolution-, scale- and
 * rotation-independent, so the same points render at any device resolution and
 * survive the original↔flattened image swap.
 */

/**
 * The annotation tools. The first five mirror the historical PDF-viewer markup
 * set; `ellipse`, `line` and `blur` are added for the image annotator. A
 * renderer that doesn't implement a given tool simply skips it (forward-compatible).
 */
export type MarkupTool =
  | 'rect'
  | 'arrow'
  | 'cloud'
  | 'freehand'
  | 'text'
  | 'ellipse'
  | 'line'
  | 'blur';

/** Visual style applied to a markup shape. */
export interface MarkupStyle {
  /** CSS hex colour, e.g. `#ef4444`. */
  color: string;
  /**
   * Stroke width expressed in {@link REFERENCE_EXTENT} units (the image's longest
   * edge is treated as `REFERENCE_EXTENT` px). Renderers scale it to their actual
   * pixel size, so the same value looks consistent on screen and in the export.
   */
  strokeWidth: number;
}

/** One persisted annotation shape. */
export interface Annotation2D {
  id: string;
  tool: MarkupTool;
  /** Normalized 0..1, top-left origin, Y-down. Point count depends on `tool`. */
  points: [number, number][];
  /** Present only for `tool === 'text'`. */
  text?: string;
  color: string;
  strokeWidth: number;
}

/**
 * The annotation reference extent. Stroke widths and text sizes are authored
 * against an image whose longest edge is this many units; renderers multiply by
 * `longestEdgePx / REFERENCE_EXTENT` to get device pixels. Keeps strokes
 * resolution-independent between the on-screen editor and the flattened export.
 */
export const REFERENCE_EXTENT = 1000;

/** Current schema version of {@link AnnotationDocument}. Bump on breaking changes. */
export const ANNOTATION_SCHEMA_VERSION = 1;

/**
 * The full persisted payload stored alongside an attachment (its
 * `annotation_state`). Carries the vector annotations plus a pointer to the
 * original (un-annotated) image version they were authored against, so the
 * editor can always re-burn from the pristine source.
 */
export interface AnnotationDocument {
  schemaVersion: number;
  /** Attachment version id of the source image the annotations target. */
  sourceVersionId?: string;
  annotations: Annotation2D[];
}
