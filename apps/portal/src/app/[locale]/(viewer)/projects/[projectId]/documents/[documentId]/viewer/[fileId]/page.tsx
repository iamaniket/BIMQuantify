'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { setViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { useRouter } from '@/i18n/navigation';

/**
 * Legacy single-file viewer URL
 * (`/projects/[projectId]/documents/[documentId]/viewer/[fileId]`).
 *
 * The viewer now lives at the clean `/projects/[projectId]/viewer` with the
 * loaded file held in the selection store (no document/file GUIDs in the URL).
 * This shim translates an old bookmark into a `single` store target and
 * redirects, preserving a `?finding=` deep-link.
 *
 * NB: the route segment is `[documentId]` — reading `params.modelId` here
 * yields `undefined`, which then builds a `/documents/undefined/...` viewer
 * bundle URL (404). The store's `single` target still keys the document by its
 * `modelId` field, so we map `documentId` → `modelId` explicitly.
 */
export default function LegacyViewerRedirect(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string; documentId: string; fileId: string }>();
  const { projectId, documentId, fileId } = params;
  const finding = useSearchParams().get('finding');

  useEffect(() => {
    setViewerTarget(projectId, {
      kind: 'single',
      modelId: documentId,
      fileId,
      ...(finding !== null ? { findingId: finding } : {}),
    });
    router.replace(`/projects/${projectId}/viewer`);
  }, [router, projectId, documentId, fileId, finding]);

  return <main className="flex flex-1 items-center justify-center" />;
}
