'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listDocuments } from '@/lib/api/documents';
import type { DocumentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

export function useDocuments(projectId: string): UseQueryResult<DocumentList> {
  return useAuthQuery({
    queryKey: documentsKey(projectId),
    queryFn: (accessToken) => listDocuments(accessToken, projectId),
    enabled: projectId.length > 0,
  });
}
