import type { JSX } from 'react';

import { FreeViewerApp } from '@/features/free-viewer/FreeViewerApp';

/**
 * Free IFC viewer — upload + my-models list (Phase 3). The Phase-0 coming-soon
 * landing is now rendered by `FreeViewerApp` only when the API reports the tier
 * is disabled (FREE_TIER_DISABLED); otherwise this is the real app. The
 * org-less auth shell lives in this segment's layout.tsx.
 */
export default function FreeViewerPage(): JSX.Element {
  return <FreeViewerApp />;
}
