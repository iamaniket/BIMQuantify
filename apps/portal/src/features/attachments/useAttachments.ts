'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listAttachments } from '@/lib/api/attachments';
import type { AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey, elementAttachmentsKey } from './queryKeys';

export function useAttachments(
  projectId: string,
  category?: AttachmentCategoryValue,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, category !== undefined ? { category } : undefined),
  });
}

export function useElementAttachments(
  projectId: string,
  fileId: string,
  globalId: string | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: elementAttachmentsKey(projectId, fileId, globalId ?? ''),
    queryFn: (accessToken) => {
      if (globalId === null) throw new Error('Missing globalId');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedElementGlobalId: globalId,
      });
    },
    enabled: globalId !== null,
    staleTime: 30_000,
  });
}

export function useProjectAttachments(
  projectId: string,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'unlinked'] as const,
    queryFn: (accessToken) => listAttachments(accessToken, projectId, { unlinked: true }),
  });
}

export function usePdfPageAttachments(
  projectId: string,
  fileId: string,
  page: number | null,
): UseQueryResult<AttachmentList> {
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'pdf-page', fileId, page ?? 0] as const,
    queryFn: (accessToken) => {
      if (page === null) throw new Error('Missing page');
      return listAttachments(accessToken, projectId, {
        linkedFileId: fileId,
        linkedPointType: 'pdf',
        linkedPointPage: page,
      });
    },
    enabled: page !== null,
    staleTime: 30_000,
  });
}
