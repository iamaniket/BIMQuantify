/**
 * Data types for 2D PDF markup annotations — runtime-free so the portal can
 * import them directly (they describe what is persisted in a BCF 2D viewpoint's
 * `view_state_2d` JSONB). No three.js / DOM imports here.
 *
 * Coordinate convention for {@link Annotation2D.points}: NORMALIZED to the
 * page box, range `0..1`, **top-left origin, Y-down** — identical to how
 * findings persist `anchor_x` / `anchor_y` (see the portal's
 * `schemas/anchor.ts`) and how the HTML pin overlay positions markers. This is
 * resolution-, scale- and rotation-independent.
 */

/** The five markup tools. Each is implemented by its own plugin. */
export type MarkupTool = 'rect' | 'arrow' | 'cloud' | 'freehand' | 'text';

/** Visual style applied to a markup shape. */
export interface MarkupStyle {
  /** CSS hex colour, e.g. `#ef4444`. */
  color: string;
  /** Stroke width in px at scale = 1 (render hint; geometry itself is scale-free). */
  strokeWidth: number;
}

/** One persisted markup shape. */
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
 * The whole markup payload for one topic's 2D viewpoint. Stored verbatim in the
 * BCF viewpoint's `view_state_2d` JSONB column.
 */
export interface Markup2DViewState {
  /** 1-based PDF page the markup lives on. */
  page: number;
  file_type: 'pdf';
  /** Camera centre (page-box normalized 0..1) + zoom, for restoring the view. */
  center_x: number;
  center_y: number;
  zoom: number;
  annotations: Annotation2D[];
}

/** Returned by the `markup.getDraft` command after a shape is drawn. */
export interface MarkupDraft {
  tool: MarkupTool;
  /** 1-based page the draft was drawn on. */
  page: number;
  /** Normalized 0..1, top-left — ready to drop into {@link Annotation2D.points}. */
  points: [number, number][];
  text?: string;
  color: string;
  strokeWidth: number;
  /** Normalized centroid — the suggested pin/anchor position for the topic. */
  anchor: { x: number; y: number };
}

/** Input to the `markup.setCommitted` command — one entry per existing topic. */
export interface CommittedMarkupItem {
  topicId: string;
  /** 1-based page. Only entries on the current page render. */
  page: number;
  annotations: Annotation2D[];
}
