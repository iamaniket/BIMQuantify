'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { deleteModel } from '@/lib/api/models';
import { useAuth } from '@/providers/AuthProvider';

import { modelsKey } from './queryKeys';

type DeleteInput = { projectId: string; modelId: string };

export function useDeleteModel(): UseMutationResult<undefined, Error, DeleteInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<undefined, Error, DeleteInput>({
    mutationFn: async ({ projectId, modelId }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      await deleteModel(accessToken, projectId, modelId);
      return undefined;
    },
    onSuccess: async (_data, { projectId }) => {
      await queryClient.invalidateQueries({ queryKey: modelsKey(projectId) });
    },
  });
}
