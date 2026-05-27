'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateAttachment } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

type UpdateVars = {
  attachmentId: string;
  input: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
  };
};

export function useUpdateAttachment(
  projectId: string,
): UseMutationResult<Attachment, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { attachmentId, input }) =>
      updateAttachment(accessToken, projectId, attachmentId, input),
    invalidateKeys: [attachmentsKey(projectId)],
  });
}
