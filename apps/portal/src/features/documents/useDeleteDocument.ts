'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteDocument } from '@/lib/api/documents';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

export function useDeleteDocument(
  projectId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, documentId) =>
      deleteDocument(accessToken, projectId, documentId),
    invalidateKeys: [documentsKey(projectId)],
  });
}
