'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { revokeCaptureLink } from '@/lib/api/attachments';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { captureLinksKey } from './queryKeys';

export function useRevokeCaptureLink(
  projectId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, linkId) =>
      revokeCaptureLink(accessToken, projectId, linkId),
    invalidateKeys: [captureLinksKey(projectId)],
  });
}
