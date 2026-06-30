'use client';

import { type JSX } from 'react';

import { PaidProjectsView } from '@/features/projects/PaidProjectsView';
import { useIsPooledContext } from '@/hooks/useIsPooledContext';

/**
 * The dashboard home — the SAME projects UI for paid and free (org-less) users.
 * `PaidProjectsView`'s data hooks (`useProjects`, `useExpiringCertificates`, the
 * per-project members fetch) are free-aware and branch on `useIsPooledContext()`, so
 * a free user lists their pooled `free_projects` through the identical
 * components. Defer the first render until `/auth/me` resolves so the hooks know
 * which tier to fetch for (avoids a wrong-endpoint flash).
 */
export default function ProjectsPage(): JSX.Element {
  const { ready } = useIsPooledContext();
  if (!ready) {
    return <main className="flex flex-1 items-center justify-center" />;
  }
  return <PaidProjectsView />;
}
