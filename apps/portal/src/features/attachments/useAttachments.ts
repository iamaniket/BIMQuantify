'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listAttachments } from '@/lib/api/attachments';
import type { AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

export function useAttachments(
  projectId: string,
  category?: AttachmentCategoryValue,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, category),
  });
}
