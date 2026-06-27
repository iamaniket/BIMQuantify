/**
 * Hardcoded WKB/Bbl snags pinned onto the marketing demo model. The vocabulary
 * mirrors the real `Finding` model (severity / status / Bbl article); titles are
 * referenced by i18n key so they stay bilingual.
 *
 * `position` (model LOCAL frame) is a LAST-RESORT FALLBACK only. Placement is
 * computed at load from the model's GEOMETRY: `snagPlacementPlugin` picks
 * `count` well-spread COMPACT-element bbox centroids (always on a building part)
 * and refines each to a true surface point via a raycast when the GPU pick buffer
 * is fresh (`showcase.elementPoints`). It always returns `count` ON-MODEL points,
 * so these authored coords are reached only if the model has no usable geometry
 * at all. IMPORTANT: they are NOT kept in sync with `public/models/demo.frag`
 * (a real project model) — their literal x/y/z almost certainly sit OFF the
 * current model's bounding box. Don't rely on them as real placements; the
 * raycast path supplies the actual on-model points. Fix the geometry path
 * (snagPlacementPlugin / `showcase.elementPoints`) if pins go missing.
 */

export type DemoSnagSeverity = 'low' | 'medium' | 'high';
export type DemoSnagStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'verified';
export type DemoSnagKey =
  | 'wall'
  | 'cover'
  | 'pipe'
  | 'airtight'
  | 'insulation'
  | 'glazing'
  | 'drainage'
  | 'ventilation'
  | 'balustrade'
  | 'rebar';

export type DemoSnag = {
  id: string;
  titleKey: DemoSnagKey;
  severity: DemoSnagSeverity;
  status: DemoSnagStatus;
  bblArticleRef: string;
  position: { x: number; y: number; z: number };
};

/** Stable id for the single demo model — must match the markers' `modelId`. */
export const DEMO_MODEL_ID = 'web-demo';

export const DEMO_SNAGS: readonly DemoSnag[] = [
  {
    id: 'snag-wall',
    titleKey: 'wall',
    severity: 'high',
    status: 'open',
    bblArticleRef: '4.51',
    position: { x: 45, y: 6.5, z: -2 },
  },
  {
    id: 'snag-cover',
    titleKey: 'cover',
    severity: 'medium',
    status: 'in_progress',
    bblArticleRef: '4.20',
    position: { x: 16, y: 0.8, z: -10 },
  },
  {
    id: 'snag-pipe',
    titleKey: 'pipe',
    severity: 'high',
    status: 'resolved',
    bblArticleRef: '4.124',
    position: { x: 30, y: 9.5, z: -15 },
  },
  {
    id: 'snag-airtight',
    titleKey: 'airtight',
    severity: 'medium',
    status: 'verified',
    bblArticleRef: '4.150',
    position: { x: 8, y: 13, z: 2 },
  },
  {
    id: 'snag-insulation',
    titleKey: 'insulation',
    severity: 'low',
    status: 'open',
    bblArticleRef: '4.149',
    position: { x: 25, y: 14, z: -8 },
  },
  {
    id: 'snag-glazing',
    titleKey: 'glazing',
    severity: 'medium',
    status: 'in_progress',
    bblArticleRef: '4.83',
    position: { x: 38, y: 3.5, z: -12 },
  },
  {
    id: 'snag-drainage',
    titleKey: 'drainage',
    severity: 'high',
    status: 'open',
    bblArticleRef: '3.24',
    position: { x: 12, y: 15.5, z: -4 },
  },
  {
    id: 'snag-ventilation',
    titleKey: 'ventilation',
    severity: 'low',
    status: 'in_progress',
    bblArticleRef: '4.117',
    position: { x: 20, y: 5, z: 1 },
  },
  {
    id: 'snag-balustrade',
    titleKey: 'balustrade',
    severity: 'high',
    status: 'resolved',
    bblArticleRef: '4.21',
    position: { x: 5, y: 9, z: -14 },
  },
  {
    id: 'snag-rebar',
    titleKey: 'rebar',
    severity: 'medium',
    status: 'verified',
    bblArticleRef: '4.12',
    position: { x: 48, y: 11, z: -9 },
  },
];
