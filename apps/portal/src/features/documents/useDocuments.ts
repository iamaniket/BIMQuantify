'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { listDocuments, listDocumentsWithVersions } from '@/lib/api/documents';
import type { DocumentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

/** Free-aware: a free project's containers are its pooled models, served as the
 * same `Document` shape from `/pooled/projects/{id}/documents`. */
export function useDocuments(projectId: string): UseQueryResult<DocumentList> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: documentsKey(projectId),
    queryFn: (accessToken) =>
      isPooled
        ? listDocumentsWithVersions(accessToken, projectId, true)
        : listDocuments(accessToken, projectId),
    // Gated on `ready`: until /auth/me resolves, `isPooled` is false and a free
    // user would hit the org-only `/projects/{id}/documents` endpoint → 409.
    enabled: ready && projectId.length > 0,
  });
}
