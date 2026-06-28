'use client';

import { type JSX } from 'react';

import { FreeProjectsView } from '@/features/free-viewer/FreeProjectsView';
import { PaidProjectsView } from '@/features/projects/PaidProjectsView';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';

/**
 * The dashboard home. A free (org-less) user has no org-scoped projects, so the
 * page selects on `isFreeUser`: free users see their uploaded free models
 * (`FreeProjectsView`), paid users the real org projects (`PaidProjectsView`).
 * Splitting into child components keeps the org-scoped `useProjects()` hook off
 * the free path entirely. Defer until `/auth/me` resolves to avoid a flash.
 */
export default function ProjectsPage(): JSX.Element {
  const { isFreeUser, ready } = useIsFreeUser();
  if (!ready) {
    return <main className="flex flex-1 items-center justify-center" />;
  }
  return isFreeUser ? <FreeProjectsView /> : <PaidProjectsView />;
}
