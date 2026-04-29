'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { updateModel } from '@/lib/api/models';
import type { Model, ModelUpdateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelKey, modelsKey } from './queryKeys';

type UpdateInput = {
  projectId: string;
  modelId: string;
  input: ModelUpdateInput;
};

export function useUpdateModel(): UseMutationResult<Model, Error, UpdateInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Model, Error, UpdateInput>({
    mutationFn: async ({ projectId, modelId, input }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return updateModel(accessToken, projectId, modelId, input);
    },
    onSuccess: async (_data, { projectId, modelId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: modelsKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: modelKey(projectId, modelId) }),
      ]);
    },
  });
}
