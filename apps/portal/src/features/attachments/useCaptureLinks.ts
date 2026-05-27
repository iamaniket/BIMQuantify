'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listCaptureLinks } from '@/lib/api/attachments';
import type { CaptureLinkList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { captureLinksKey } from './queryKeys';

export function useCaptureLinks(
  projectId: string,
): UseQueryResult<CaptureLinkList> {
  return useAuthQuery({
    queryKey: captureLinksKey(projectId),
    queryFn: (accessToken) => listCaptureLinks(accessToken, projectId),
  });
}
