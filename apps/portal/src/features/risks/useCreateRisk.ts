'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createRisk } from '@/lib/api/risks';
import type { Risk, RiskCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { risksKey } from './queryKeys';

export function useCreateRisk(
  projectId: string,
): UseMutationResult<Risk, Error, RiskCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createRisk(accessToken, projectId, input),
    invalidateKeys: [risksKey(projectId)],
  });
}
