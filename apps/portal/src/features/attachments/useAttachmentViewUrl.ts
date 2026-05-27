'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getAttachmentViewUrl } from '@/lib/api/attachments';
import type { AttachmentDownloadResponse } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

export function useAttachmentViewUrl(
  projectId: string,
  attachmentId: string | null,
): UseQueryResult<AttachmentDownloadResponse> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), attachmentId, 'view-url'] as const,
    queryFn: (accessToken) => getAttachmentViewUrl(accessToken, projectId, attachmentId!),
    enabled: attachmentId !== null,
    staleTime: 10 * 60 * 1000,
  });
}
