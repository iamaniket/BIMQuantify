'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteAttachment } from '@/lib/api/attachments';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

export function useDeleteAttachment(
  projectId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, attachmentId) =>
      deleteAttachment(accessToken, projectId, attachmentId),
    invalidateKeys: [attachmentsKey(projectId)],
  });
}
