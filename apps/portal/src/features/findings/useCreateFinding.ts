'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createFinding } from '@/lib/api/findings';
import type { Finding, FindingCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

export function useCreateFinding(
  projectId: string,
): UseMutationResult<Finding, Error, FindingCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createFinding(accessToken, projectId, input),
    invalidateKeys: [findingsKey(projectId)],
  });
}
