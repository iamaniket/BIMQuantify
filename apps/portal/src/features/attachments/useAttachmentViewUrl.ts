'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeContext } from '@/hooks/useIsFreeUser';
import { getAttachmentViewUrl } from '@/lib/api/attachments';
import { getFreeAttachmentViewUrl } from '@/lib/api/freeAttachments';
import type { AttachmentDownloadResponse } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { attachmentsKey } from './queryKeys';

export function useAttachmentViewUrl(
  projectId: string,
  attachmentId: string | null,
): UseQueryResult<AttachmentDownloadResponse> {
  // Free findings carry free attachments (different download endpoint); branch so
  // a free user can view photos logged on mobile. `ready` defers the fetch until
  // /auth/me resolves so the free/paid branch isn't chosen prematurely (409 flash).
  const { isFreeUser, ready } = useIsFreeContext();
  return useAuthQuery({
    queryKey: [...attachmentsKey(projectId), attachmentId, 'view-url', isFreeUser] as const,
    queryFn: (accessToken) => {
      const fetchUrl = isFreeUser ? getFreeAttachmentViewUrl : getAttachmentViewUrl;
      return fetchUrl(accessToken, projectId, attachmentId!);
    },
    enabled: ready && attachmentId !== null,
    staleTime: 10 * 60 * 1000,
  });
}
