'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateDocument } from '@/lib/api/documents';
import type { Document, DocumentUpdateInput } from '@/lib/api/schemas';
import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey, documentsWithVersionsKey } from './queryKeys';

type UpdateInput = { projectId: string; documentId: string; input: DocumentUpdateInput };

export function useUpdateDocument(): UseMutationResult<Document, Error, UpdateInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, documentId, input }) =>
      updateDocument(accessToken, projectId, documentId, input, isPooled),
    invalidateKeys: ({ projectId }) => [
      documentsKey(projectId),
      documentsWithVersionsKey(projectId),
    ],
  });
}
