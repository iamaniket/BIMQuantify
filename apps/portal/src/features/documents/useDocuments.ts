'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listDocuments } from '@/lib/api/documents';
import type { DocumentCategoryValue, DocumentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

export function useDocuments(
  projectId: string,
  category?: DocumentCategoryValue,
): UseQueryResult<DocumentList> {
  return useAuthQuery({
    queryKey: [...documentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken) => listDocuments(accessToken, projectId, category),
  });
}
