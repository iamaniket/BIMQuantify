'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateMoment } from '@/lib/api/borgingsplan';
import type {
  Borgingsmoment,
  BorgingsmomentUpdateInput,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { borgingsplanKey } from './queryKeys';

type UpdateVars = { momentId: string; input: BorgingsmomentUpdateInput };

export function useUpdateMoment(
  projectId: string,
  planId: string,
): UseMutationResult<Borgingsmoment, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { momentId, input }) =>
      updateMoment(accessToken, planId, momentId, input),
    invalidateKeys: [borgingsplanKey(projectId)],
  });
}
