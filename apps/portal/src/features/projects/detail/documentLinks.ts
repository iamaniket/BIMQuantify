import type { AlignedSheet } from '@/lib/api/schemas';

/**
 * Shared view-model + helpers for surfacing the PDF ↔ storey ↔ 3D-model
 * relationship (AlignedSheet) in the project document list. The list groups
 * 2D drawings by `Document.level_id`, but the real, per-page link lives in
 * AlignedSheets — these types carry the resolved (name-ready) shape down to
 * the presentational row.
 */

/** Calibration state of a single aligned page, worst-first when escalated. */
export type LinkState = 'calibrated' | 'uncalibrated' | 'stale';

/** One aligned page of a PDF document → the storey/level + 3D model it pins to. */
export type PdfPageLink = {
  pageNumber: number;
  levelId: string;
  levelName: string;
  modelName: string;
  state: LinkState;
};

/** One drawing-page aligned to a 3D model, grouped under its level/storey. */
export type ModelDrawingLink = {
  drawingId: string;
  drawingName: string;
  pageNumber: number;
  levelId: string;
  levelName: string;
  state: LinkState;
};

/** Derive the display state of a single sheet: stale beats not-yet-calibrated. */
export function linkState(sheet: AlignedSheet): LinkState {
  if (sheet.is_stale) return 'stale';
  if (sheet.is_calibrated) return 'calibrated';
  return 'uncalibrated';
}

const STATE_RANK: Record<LinkState, number> = {
  calibrated: 0,
  uncalibrated: 1,
  stale: 2,
};

/**
 * Most attention-needing state across a set of links (stale > uncalibrated >
 * calibrated). Only call with a non-empty set; defaults to `calibrated`.
 */
export function escalateState(states: readonly LinkState[]): LinkState {
  return states.reduce<LinkState>(
    (worst, s) => (STATE_RANK[s] > STATE_RANK[worst] ? s : worst),
    'calibrated',
  );
}
