import type { JSX } from 'react';

import { FreeViewerComingSoon } from '@/features/free-viewer/FreeViewerComingSoon';
import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

/**
 * Phase 0 landing for the free IFC viewer wedge (see
 * docs/free-wedge-implementation-plan.md). Every "View your model free" CTA on
 * the marketing site lands here, so this is the single instrumented surface for
 * measuring free-tier demand before the backend tier is built.
 */
export default function FreeViewerPage(): JSX.Element {
  return (
    <AuthLayoutShell>
      <FreeViewerComingSoon />
    </AuthLayoutShell>
  );
}
