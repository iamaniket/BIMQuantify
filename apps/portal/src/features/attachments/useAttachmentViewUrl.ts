'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { getAttachmentViewUrl } from '@/lib/api/attachments';
import type { AttachmentDownloadResponse } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

export function useAttachmentViewUrl(
  projectId: string,
  attachmentId: string | null,
): UseQueryResult<AttachmentDownloadResponse> {
  // Free findings carry free attachments on the `/free/*` surface (identical
  // download schema); pass the tier flag so one fetcher serves both. `ready`
  // defers the fetch until /auth/me resolves so the branch isn't chosen
  // prematurely (409 flash).
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), attachmentId, 'view-url', isPooled] as const,
    queryFn: (accessToken) =>
      getAttachmentViewUrl(accessToken, projectId, attachmentId!, isPooled),
    enabled: ready && attachmentId !== null,
    staleTime: 10 * 60 * 1000,
  });
}
