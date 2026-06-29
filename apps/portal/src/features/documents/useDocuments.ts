'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listDocuments, listDocumentsWithVersions } from '@/lib/api/documents';
import type { DocumentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

/** Free-aware: a free project's containers are its pooled models, served as the
 * same `Document` shape from `/free/projects/{id}/documents`. */
export function useDocuments(projectId: string): UseQueryResult<DocumentList> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthQuery({
    queryKey: documentsKey(projectId),
    queryFn: (accessToken) =>
      isFreeUser
        ? listDocumentsWithVersions(accessToken, projectId, true)
        : listDocuments(accessToken, projectId),
    enabled: projectId.length > 0,
  });
}
