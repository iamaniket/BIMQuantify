'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteRisk } from '@/lib/api/risks';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { risksKey } from './queryKeys';

export function useDeleteRisk(projectId: string): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, riskId) => deleteRisk(accessToken, projectId, riskId),
    invalidateKeys: [risksKey(projectId)],
  });
}
