/**
 * Hardcoded WKB/Bbl snags pinned onto the marketing demo model. The vocabulary
 * mirrors the real `Finding` model (severity / status / Bbl article); titles are
 * referenced by i18n key so they stay bilingual.
 *
 * `position` is in the demo model's LOCAL (authored) frame. The current model
 * (apps/web/public/models/demo.frag) has a bounding box of roughly
 * x -0.6–52.0, y -0.4–16.8 (up), z -18.8–5.7 (a large building), so the pins
 * below sit across its surface. Re-tune these if `public/models/demo.frag` is
 * swapped for a different model.
 */

export type DemoSnagSeverity = 'low' | 'medium' | 'high';
export type DemoSnagStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'resolved'
  | 'verified';
export type DemoSnagKey = 'wall' | 'cover' | 'pipe' | 'airtight';

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
];
