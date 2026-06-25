/**
 * Half-band (model units) for assigning a finding to a level by elevation.
 *
 * Shared by the generated-plan marker hook (`useFloorPlanFindingMarkers`) and
 * the aligned-sheet marker hook (`useAlignedSheetMarkers`) so both filter
 * findings to the active storey the same way.
 */
export function elevationBand(levels: { elevation: number }[], index: number): number {
  const e = levels[index]?.elevation;
  if (e == null) return 1.5;
  let nearest = Infinity;
  levels.forEach((lv, i) => {
    if (i === index) return;
    nearest = Math.min(nearest, Math.abs(lv.elevation - e));
  });
  return Number.isFinite(nearest) ? Math.max(nearest / 2, 0.5) : 1.5;
}
