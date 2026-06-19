/**
 * Data types for 2D PDF markup annotations — runtime-free so the portal can
 * import them directly (they describe what is persisted in a BCF 2D viewpoint's
 * `view_state_2d` JSONB). No three.js / DOM imports here.
 *
 * The shape model ({@link Annotation2D} / {@link MarkupTool} / {@link MarkupStyle})
 * is the SINGLE source of truth in `@bimstitch/annotation` and re-exported here
 * so the PDF/3D viewer, the image annotator and future mobile all speak one
 * model. The viewer's PDF tools implement only `rect|arrow|cloud|freehand|text`;
 * the wider union (incl. `ellipse|line|blur`) is forward-compatible — the markup
 * core's tool registry simply has no entry for tools it doesn't implement, so
 * receiving one renders nothing rather than erroring.
 *
 * Coordinate convention for {@link Annotation2D.points}: NORMALIZED to the
 * page box, range `0..1`, **top-left origin, Y-down** — identical to how
 * findings persist `anchor_x` / `anchor_y` (see the portal's
 * `schemas/anchor.ts`) and how the HTML pin overlay positions markers. This is
 * resolution-, scale- and rotation-independent.
 */

import type { Annotation2D, MarkupTool } from '@bimstitch/annotation';

export type { Annotation2D, MarkupStyle, MarkupTool } from '@bimstitch/annotation';

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
