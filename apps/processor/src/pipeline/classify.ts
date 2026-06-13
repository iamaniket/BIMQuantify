/**
 * Content-based discipline classification from an IFC element-type histogram.
 *
 * Drives two decisions:
 *   1. Whether to generate the level-based floor-plan artifact at all — the
 *      1.2 m horizontal section cut (floorplans.ts) is an *architectural*
 *      convention. For an MEP / structural-only model it produces noise
 *      (scattered pipe/duct cross-sections), so the cut is skipped and the
 *      viewer stays 3D-only. Only `architectural` and `mixed` get a plan.
 *   2. A discipline label surfaced on the file (`detected_kind`) so the portal
 *      can badge each model and, in a federated multi-discipline view, pick the
 *      architectural model as the one that supplies the 2D plan.
 *
 * IMPORTANT: reads the RAW `elementCounts` (PascalCase IFC type → count, built
 * by metadata.ts::countElements), NOT `canonicalElementCounts`. The canonical
 * taxonomy (canonical.ts::IFC_ENTITY_TO_CANONICAL) deliberately omits every MEP
 * type — ducts/pipes/flow-fittings/terminals live in EXTRA_PRODUCT_TYPES and
 * are dropped from the canonical map — so canonical counts carry zero MEP
 * signal and cannot distinguish an HVAC model from an empty one.
 */

export type DetectedKind =
  | 'architectural'
  | 'structural'
  | 'mep'
  | 'mixed'
  | 'none';

// Architectural envelope + space program: the element families a plan cut is
// meant to read (walls, openings, slabs, rooms, circulation).
const ARCH_TYPES: readonly string[] = [
  'IfcWall',
  'IfcWallStandardCase',
  'IfcSlab',
  'IfcDoor',
  'IfcWindow',
  'IfcSpace',
  'IfcCovering',
  'IfcRoof',
  'IfcCurtainWall',
  'IfcStair',
  'IfcStairFlight',
  'IfcRamp',
  'IfcRampFlight',
  'IfcRailing',
];

// Load-bearing frame + foundations.
const STRUCT_TYPES: readonly string[] = [
  'IfcColumn',
  'IfcBeam',
  'IfcFooting',
  'IfcPile',
  'IfcMember',
  'IfcPlate',
];

// Distribution systems (HVAC / plumbing / fire). All live in
// canonical.ts::EXTRA_PRODUCT_TYPES, hence the raw-counts requirement above.
const MEP_TYPES: readonly string[] = [
  'IfcDuctSegment',
  'IfcPipeSegment',
  'IfcFlowSegment',
  'IfcFlowFitting',
  'IfcFlowTerminal',
  'IfcDistributionPort',
];

// A discipline is materially present (vs. incidental noise). This is the gate:
// once architectural content (walls/spaces/slabs…) reaches this share, a plan
// cut is worth drawing — even if structural members outnumber it by raw count,
// which they often do (a frame has many small beams/members). Below this for
// architecture → the model is non-architectural (MEP/structural) → 3D-only.
const PRESENT_SHARE = 0.2;
// Architecture clearly dominates → `architectural` even if a second discipline
// is also present; below this with another present → `mixed` (coordination).
const MAJORITY_SHARE = 0.5;

// IfcBuildingElementProxy / IfcFurnishingElement are intentionally excluded
// from every bucket: a proxy carries no discipline signal (any tool may export
// anything as a proxy) and furniture appears across disciplines. Counting them
// would muddy the dominant-share decision.

function sumTypes(
  counts: Record<string, number>,
  types: readonly string[],
): number {
  let total = 0;
  for (const t of types) total += counts[t] ?? 0;
  return total;
}

/**
 * Classify a model from its element-type histogram. Pure; safe on an empty or
 * partial histogram (returns `none` when no classified geometry is present).
 */
export function detectContentKind(
  elementCounts: Record<string, number>,
): DetectedKind {
  const arch = sumTypes(elementCounts, ARCH_TYPES);
  const struct = sumTypes(elementCounts, STRUCT_TYPES);
  const mep = sumTypes(elementCounts, MEP_TYPES);
  const total = arch + struct + mep;
  if (total === 0) return 'none';

  const archShare = arch / total;
  const structShare = struct / total;
  const mepShare = mep / total;

  // Architecture materially present → the model is a building with walls/rooms,
  // so a floor plan reads. (This is the gate `shouldGenerateFloorPlan` keys on.)
  if (archShare >= PRESENT_SHARE) {
    const otherPresent =
      structShare >= PRESENT_SHARE || mepShare >= PRESENT_SHARE;
    // A second discipline also strongly present and architecture not dominant →
    // a coordination/federated export. Otherwise it's an architectural model.
    return otherPresent && archShare < MAJORITY_SHARE ? 'mixed' : 'architectural';
  }

  // Architecture negligible → non-architectural model (3D-only). Label it by
  // the dominant remaining discipline so the badge is meaningful.
  return mep >= struct ? 'mep' : 'structural';
}

/**
 * Whether a model with this content kind should get the level-based floor-plan
 * artifact. The 1.2 m architectural section cut is only meaningful when the
 * model carries architectural envelope/space geometry.
 */
export function shouldGenerateFloorPlan(kind: DetectedKind): boolean {
  return kind === 'architectural' || kind === 'mixed';
}
