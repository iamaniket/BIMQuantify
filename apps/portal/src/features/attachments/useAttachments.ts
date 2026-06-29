'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listAttachments } from '@/lib/api/attachments';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Attachment, AttachmentCategoryValue, AttachmentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { attachmentsKey } from './queryKeys';

// Attachments are an ORG-only feature — there is no `/free/.../attachments`
// endpoint, and a free (org-less) caller's JWT carries no `org` claim, so the
// paid endpoint 409s (`NO_ACTIVE_ORGANIZATION`). Gate every consumer here so the
// query never fires in free context. `ready` (false until `/auth/me` loads)
// keeps it disabled until the context is known, avoiding a 409 flash for free
// users. Disabled → `data` stays undefined, which `flattenPages` /
// `totalFromPages` / `useAllInfinitePages` already treat as empty.

export function useAttachments(
  projectId: string,
  category?: AttachmentCategoryValue,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Attachment[]>>> {
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), category ?? 'all'] as const,
    queryFn: (accessToken, offset, limit) =>
      listAttachments(accessToken, projectId, category !== undefined ? { category, limit, offset } : { limit, offset }),
    enabled: ready && !isFreeUser,
  });
}

export function useUnslottedDocuments(
  projectId: string,
  enabled = true,
): { data: AttachmentList | undefined; isLoading: boolean } {
  const { isFreeUser, ready } = useIsFreeUser();
  const query = useAuthQuery({
    queryKey: [...attachmentsKey(projectId), 'unslotted', 'office'] as const,
    queryFn: async (accessToken) => {
      const resp = await listAttachments(accessToken, projectId, { unslotted: true, category: 'office' });
      return resp.data;
    },
    enabled: enabled && ready && !isFreeUser,
    staleTime: 15_000,
  });
  return { data: query.data, isLoading: query.isLoading };
}

export function useFileAttachmentCount(
  projectId: string,
  fileId: string | null,
): number {
  const { isFreeUser, ready } = useIsFreeUser();
  const query = useAuthInfiniteQuery({
    queryKey: [...attachmentsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listAttachments(accessToken, projectId, { linkedFileId: fileId, limit, offset });
    },
    enabled: fileId !== null && ready && !isFreeUser,
  });
  return totalFromPages(query.data);
}
