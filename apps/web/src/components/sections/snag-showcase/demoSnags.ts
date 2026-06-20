/**
 * Hardcoded WKB/Bbl snags pinned onto the marketing demo model. The vocabulary
 * mirrors the real `Finding` model (severity / status / Bbl article); titles are
 * referenced by i18n key so they stay bilingual.
 *
 * `position` (model LOCAL frame) is now only a FALLBACK. Primary placement is
 * computed at load from the model's GEOMETRY: `snagPlacementPlugin` reads every
 * element's bounding box and SnagViewer pins each snag to a well-spread element
 * centroid (`showcase.elementPoints`). These coords are used only if that returns
 * fewer points than snags, so the demo survives a swap of `public/models/demo.frag`
 * without manual re-tuning. The current model's bounding box is roughly
 * x -0.6–52.0, y -0.4–16.8 (up), z -18.8–5.7 (a large building).
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
