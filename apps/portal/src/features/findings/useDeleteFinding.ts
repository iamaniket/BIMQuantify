'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { deleteFinding } from '@/lib/api/findings';
import { deletePooledFinding } from '@/lib/api/pooledFindings';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

/** Free-aware: a free "finding" is a pooled snag → `DELETE /pooled/findings/{id}`. */
export function useDeleteFinding(projectId: string): UseMutationResult<void, Error, string> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, findingId) =>
      isPooled
        ? deletePooledFinding(accessToken, findingId)
        : deleteFinding(accessToken, projectId, findingId),
    invalidateKeys: [findingsKey(projectId)],
  });
}
