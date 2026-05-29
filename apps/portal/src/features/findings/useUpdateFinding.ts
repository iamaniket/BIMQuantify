'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateFinding } from '@/lib/api/findings';
import type { Finding, FindingUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

type Vars = { findingId: string; input: FindingUpdateInput };

export function useUpdateFinding(projectId: string): UseMutationResult<Finding, Error, Vars> {
  return useAuthMutation({
    mutationFn: (accessToken, { findingId, input }) =>
      updateFinding(accessToken, projectId, findingId, input),
    invalidateKeys: [findingsKey(projectId)],
  });
}
