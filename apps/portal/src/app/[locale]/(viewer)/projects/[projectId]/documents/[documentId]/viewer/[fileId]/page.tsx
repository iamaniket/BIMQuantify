'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { setViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { useRouter } from '@/i18n/navigation';

/**
 * Legacy single-file viewer URL
 * (`/projects/[projectId]/models/[modelId]/viewer/[fileId]`).
 *
 * The viewer now lives at the clean `/projects/[projectId]/viewer` with the
 * loaded file held in the selection store (no model/file GUIDs in the URL).
 * This shim translates an old bookmark into a `single` store target and
 * redirects, preserving a `?finding=` deep-link.
 */
export default function LegacyViewerRedirect(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string; modelId: string; fileId: string }>();
  const { projectId, modelId, fileId } = params;
  const finding = useSearchParams().get('finding');

  useEffect(() => {
    setViewerTarget(projectId, {
      kind: 'single',
      modelId,
      fileId,
      ...(finding !== null ? { findingId: finding } : {}),
    });
    router.replace(`/projects/${projectId}/viewer`);
  }, [router, projectId, modelId, fileId, finding]);

  return <main className="flex flex-1 items-center justify-center" />;
}
