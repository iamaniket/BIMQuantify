'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteFinding } from '@/lib/api/findings';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

export function useDeleteFinding(projectId: string): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, findingId) => deleteFinding(accessToken, projectId, findingId),
    invalidateKeys: [findingsKey(projectId)],
  });
}
