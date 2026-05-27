'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createCaptureLink } from '@/lib/api/attachments';
import type { CreateCaptureLinkResponse } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { captureLinksKey } from './queryKeys';

type CreateVars = {
  label?: string | null;
  ttl_hours?: number;
  max_uses?: number | null;
};

export function useCreateCaptureLink(
  projectId: string,
): UseMutationResult<CreateCaptureLinkResponse, Error, CreateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, input) =>
      createCaptureLink(accessToken, projectId, input),
    invalidateKeys: [captureLinksKey(projectId)],
  });
}
