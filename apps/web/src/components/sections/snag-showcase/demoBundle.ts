import type { ViewerBundle } from '@bimdossier/viewer';

import { DEMO_MODEL_ID } from './demoSnags';

/**
 * Self-contained demo model: a static fragments file shipped in apps/web/public,
 * so the marketing site has NO runtime dependency on the API or MinIO. The
 * viewer's WASM + worker are likewise served from apps/web's own /public.
 *
 * Shared by BOTH marketing viewers — the snag showcase (SnagViewer) and the
 * scroll story (how-it-works-story/StoryViewer). One definition means one
 * `cacheKey`, so the second viewer to mount loads the fragments straight from
 * IndexedDB instead of re-downloading the ~3.7 MB file.
 */
export const DEMO_BUNDLE: ViewerBundle = {
  fragmentsUrl: '/models/demo.frag',
  // Precomputed hard-edge outline (BIMOUTL2, gzip — the viewer's codec gunzips
  // it). Renders the crisp architectural line-drawing look over the monochrome
  // model. Both viewers add the outline plugin explicitly (it's filtered out of
  // the 'minimal' preset) with drawDuringMotion so the edges stay visible while
  // the camera moves.
  outlineUrl: '/models/demo.outline.bin',
  modelId: DEMO_MODEL_ID,
  // Bumped (v2→v3) on the model swap so returning visitors drop the
  // IndexedDB-cached old fragments + its `<cacheKey>.outline` sibling.
  cacheKey: 'web-demo-frag-v3',
};
