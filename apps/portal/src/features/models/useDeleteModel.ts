'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteModel } from '@/lib/api/models';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelsKey } from './queryKeys';

type DeleteInput = { projectId: string; modelId: string };

export function useDeleteModel(): UseMutationResult<void, Error, DeleteInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId }) =>
      deleteModel(accessToken, projectId, modelId),
    invalidateKeys: ({ projectId }) => [modelsKey(projectId)],
  });
}
