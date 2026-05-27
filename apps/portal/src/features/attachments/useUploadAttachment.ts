'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { uploadAttachmentEnd2End, type AttachmentUploadProgressEvent } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

type UploadVars = {
  file: File;
  description?: string | null;
  linked_element_global_id?: string | null;
  linked_model_id?: string | null;
  linked_point?: Record<string, unknown> | null;
  linked_file_id?: string | null;
  onProgress?: (event: AttachmentUploadProgressEvent) => void;
};

export function useUploadAttachment(
  projectId: string,
): UseMutationResult<Attachment, Error, UploadVars> {
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
      return uploadAttachmentEnd2End(
        accessToken,
        projectId,
        vars.file,
        extra,
        vars.onProgress,
      );
    },
    invalidateKeys: [attachmentsKey(projectId)],
  });
}
