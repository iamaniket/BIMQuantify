'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listAttachments } from '@/lib/api/attachments';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Attachment, AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { attachmentsKey, elementAttachmentsKey } from './queryKeys';

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

export function useElementAttachments(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  return useAuthInfiniteQuery({
    queryKey: elementAttachmentsKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken, offset, limit) => {
      if (globalId === null) throw new Error('Missing globalId');
      return listAttachments(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
        limit,
        offset,
      });
    },
    enabled: globalId !== null,
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

export function useProjectAttachments(
  projectId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), 'unlinked'] as const,
    queryFn: (accessToken, offset, limit) =>
      listAttachments(accessToken, projectId, { unlinked: true, limit, offset }),
    enabled,
  });
}

export function useProjectAttachmentCount(projectId: string, enabled = true): number {
  const query = useProjectAttachments(projectId, enabled);
  return totalFromPages(query.data);
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

export function useIfcFileAttachments(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), 'ifc-file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'ifc',
        limit,
        offset,
      });
    },
    enabled: fileId !== null,
  });
}

export function usePdfPageAttachments(
  projectId: string,
  fileId: string,
  page: number | null,
): { data: AttachmentList | undefined; isLoading: boolean } {
  const query = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'pdf-page', fileId, page ?? 0] as const,
    queryFn: async (accessToken) => {
      if (page === null) throw new Error('Missing page');
      const resp = await listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'pdf',
        anchorPage: page,
      });
      return resp.data;
    },
    enabled: page !== null,
    staleTime: 30_000,
  });
  return { data: query.data, isLoading: query.isLoading };
}

export function usePdfFileAttachments(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  return useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), 'pdf-file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedFileType: 'pdf',
        limit,
        offset,
      });
    },
    enabled: fileId !== null,
  });
}

export function usePdfFileAttachmentCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = usePdfFileAttachments(projectId, fileId);
  return totalFromPages(query.data);
}
