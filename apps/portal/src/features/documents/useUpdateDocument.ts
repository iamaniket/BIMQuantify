'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateDocument } from '@/lib/api/documents';
import type { Document } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

type UpdateVars = {
  documentId: string;
  input: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
  };
};

export function useUpdateDocument(
  projectId: string,
): UseMutationResult<Document, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { documentId, input }) =>
      updateDocument(accessToken, projectId, documentId, input),
    invalidateKeys: [documentsKey(projectId)],
  });
}
