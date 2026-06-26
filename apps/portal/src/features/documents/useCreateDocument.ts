'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createDocument } from '@/lib/api/documents';
import type { Document, DocumentCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

type CreateInput = { projectId: string; input: DocumentCreateInput };

export function useCreateDocument(): UseMutationResult<Document, Error, CreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createDocument(accessToken, projectId, input),
    invalidateKeys: ({ projectId }) => [documentsKey(projectId)],
  });
}
