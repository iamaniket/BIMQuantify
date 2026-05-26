'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { uploadDocumentEnd2End, type DocumentUploadProgressEvent } from '@/lib/api/documents';
import type { Document } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentsKey } from './queryKeys';

type UploadVars = {
  file: File;
  description?: string | null;
  linked_element_global_id?: string | null;
  linked_model_id?: string | null;
  linked_point?: Record<string, unknown> | null;
  linked_file_id?: string | null;
  onProgress?: (event: DocumentUploadProgressEvent) => void;
};

export function useUploadDocument(
  projectId: string,
): UseMutationResult<Document, Error, UploadVars> {
  return useAuthMutation({
    mutationFn: (accessToken, vars) => {
      const extra: {
        description?: string | null;
        linked_element_global_id?: string | null;
        linked_model_id?: string | null;
        linked_point?: Record<string, unknown> | null;
        linked_file_id?: string | null;
      } = {};
      if (vars.description !== undefined) extra.description = vars.description;
      if (vars.linked_element_global_id !== undefined) extra.linked_element_global_id = vars.linked_element_global_id;
      if (vars.linked_model_id !== undefined) extra.linked_model_id = vars.linked_model_id;
      if (vars.linked_point !== undefined) extra.linked_point = vars.linked_point;
      if (vars.linked_file_id !== undefined) extra.linked_file_id = vars.linked_file_id;
      return uploadDocumentEnd2End(
        accessToken,
        projectId,
        vars.file,
        extra,
        vars.onProgress,
      );
    },
    invalidateKeys: [documentsKey(projectId)],
  });
}
