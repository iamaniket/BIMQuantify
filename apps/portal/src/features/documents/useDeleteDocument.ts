'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { deleteDocument } from '@/lib/api/documents';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

type DeleteInput = { projectId: string; documentId: string };

export function useDeleteDocument(): UseMutationResult<void, Error, DeleteInput> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, documentId }) =>
      deleteDocument(accessToken, projectId, documentId, isFreeUser),
    invalidateKeys: ({ projectId }) => [documentsKey(projectId)],
  });
}
