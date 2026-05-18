'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateRisk } from '@/lib/api/risks';
import type { Risk, RiskUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { risksKey } from './queryKeys';

type Vars = { riskId: string; input: RiskUpdateInput };

export function useUpdateRisk(projectId: string): UseMutationResult<Risk, Error, Vars> {
  return useAuthMutation({
    mutationFn: (accessToken, { riskId, input }) => updateRisk(accessToken, projectId, riskId, input),
    invalidateKeys: [risksKey(projectId)],
  });
}
