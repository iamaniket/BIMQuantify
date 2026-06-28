/**
 * Pure helpers for the Split/2D drawing-source picker (Phase 2: Level-keyed,
 * cross-discipline). Extracted from FloorPlanPane so the resolution logic — which
 * drawing shows for a Level, and which source model's storeys drive the link — is
 * unit-testable without a live viewer.
 */

import type { AlignedSheet } from '@/lib/api/schemas';

import type { FloorPlanDisplayLevel } from './useFloorPlanData';

/** The storey fields the resolution needs (a subset of the API Storey row). */
export type StoreyLite = {
  express_id: number | null;
  level_id: string | null;
  elevation_m: number | null;
  name: string | null;
};

/** Sentinel for "show the generated plan" (no PDF sheet). */
export const GENERATED_SOURCE = 'generated';

/**
 * Group calibrated sheets by their shared project Level, architectural-first then
 * by page, so a federated scene surfaces every discipline's drawing on a floor.
 */
export function groupSheetsByLevel(
  sheets: AlignedSheet[],
  disciplineByPdfDocId: Map<string, string>,
): Map<string, AlignedSheet[]> {
  const byLevel = new Map<string, AlignedSheet[]>();
  for (const sh of sheets) {
    if (!sh.is_calibrated || !sh.calibrated_pdf_file_id) continue;
    const arr = byLevel.get(sh.level_id);
    if (arr) arr.push(sh);
    else byLevel.set(sh.level_id, [sh]);
  }
  for (const arr of byLevel.values()) {
    arr.sort((a, b) => {
      const da = disciplineByPdfDocId.get(a.pdf_document_id) ?? '';
      const db = disciplineByPdfDocId.get(b.pdf_document_id) ?? '';
      if (da === 'architectural' && db !== 'architectural') return -1;
      if (db === 'architectural' && da !== 'architectural') return 1;
      return a.page_index - b.page_index;
    });
  }
  return byLevel;
}

/**
 * Resolve the active sheet for a Level given the sticky preferred discipline.
 * `'generated'` (or no matching sheet) → null = show the generated plan.
 */
export function resolveActiveSheet(
  sheetsHere: AlignedSheet[],
  preferredDiscipline: string,
  disciplineByPdfDocId: Map<string, string>,
): AlignedSheet | null {
  if (preferredDiscipline === GENERATED_SOURCE || sheetsHere.length === 0) return null;
  return (
    sheetsHere.find(
      (s) => (disciplineByPdfDocId.get(s.pdf_document_id) ?? 'other') === preferredDiscipline,
    ) ?? null
  );
}

/**
 * Build display levels (elevation + storeyExpressID) from a model's storeys —
 * used as the link/marker level set when the active source is a discipline model
 * (which may have no generated floor-plan artifact to derive them from).
 */
export function buildSourceLevels(
  storeys: StoreyLite[],
  levelFallback: (n: number) => string,
): FloorPlanDisplayLevel[] {
  return [...storeys]
    .filter((s) => s.express_id != null)
    .sort((a, b) => (b.elevation_m ?? 0) - (a.elevation_m ?? 0))
    .map((s, i) => ({
      storeyExpressID: s.express_id!,
      elevation: s.elevation_m ?? 0,
      name: s.name ?? levelFallback(i + 1),
      storeyName: s.name,
    }));
}

/**
 * Index, within `sourceLevels`, of the source storey reconciled onto the active
 * project Level. Falls back to 0 when the source model has no storey there.
 */
export function sourceActiveLevelIndex(
  sourceLevels: FloorPlanDisplayLevel[],
  storeys: StoreyLite[],
  activeLevelId: string | undefined,
): number {
  if (!activeLevelId) return 0;
  const expr = storeys.find((s) => s.level_id === activeLevelId)?.express_id;
  const idx = expr != null ? sourceLevels.findIndex((l) => l.storeyExpressID === expr) : -1;
  return idx >= 0 ? idx : 0;
}
