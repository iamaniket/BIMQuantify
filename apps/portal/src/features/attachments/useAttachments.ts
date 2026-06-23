'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listAttachments } from '@/lib/api/attachments';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Attachment, AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { attachmentsKey } from './queryKeys';

export function useAttachments(
  projectId: string,
  category?: AttachmentCategoryValue,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken, offset, limit) =>
      listAttachments(accessToken, projectId, category !== undefined ? { category, limit, offset } : { limit, offset }),
  });
}

export function useUnslottedDocuments(
  projectId: string,
  enabled = true,
): { data: AttachmentList | undefined; isLoading: boolean } {
  const query = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'unslotted', 'office'] as const,
    queryFn: async (accessToken) => {
      const resp = await listAttachments(accessToken, projectId, { unslotted: true, category: 'office' });
      return resp.data;
    },
    enabled,
    staleTime: 15_000,
  });
  return { data: query.data, isLoading: query.isLoading };
}

export function useFileAttachmentCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, { linkedFileId: fileId, limit, offset });
    },
    enabled: fileId !== null,
  });
  return totalFromPages(query.data);
}
