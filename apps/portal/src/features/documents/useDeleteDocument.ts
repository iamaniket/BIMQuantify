'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { deleteDocument } from '@/lib/api/documents';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

type DeleteInput = { projectId: string; documentId: string };

export function useDeleteDocument(): UseMutationResult<void, Error, DeleteInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, documentId }) =>
      deleteDocument(accessToken, projectId, documentId, isPooled),
    invalidateKeys: ({ projectId }) => [documentsKey(projectId)],
  });
}
