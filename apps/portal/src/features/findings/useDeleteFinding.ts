'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { deleteFinding } from '@/lib/api/findings';
import { deleteFreeFinding } from '@/lib/api/freeFindings';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

/** Free-aware: a free "finding" is a pooled snag → `DELETE /pooled/findings/{id}`. */
export function useDeleteFinding(projectId: string): UseMutationResult<void, Error, string> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, findingId) =>
      isFreeUser
        ? deleteFreeFinding(accessToken, findingId)
        : deleteFinding(accessToken, projectId, findingId),
    invalidateKeys: [findingsKey(projectId)],
  });
}
