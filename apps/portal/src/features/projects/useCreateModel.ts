'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { createModel } from '@/lib/api/models';
import type { Model, ModelCreateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelsKey } from './queryKeys';

type CreateInput = { projectId: string; input: ModelCreateInput };

export function useCreateModel(): UseMutationResult<Model, Error, CreateInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Model, Error, CreateInput>({
    mutationFn: async ({ projectId, input }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return createModel(accessToken, projectId, input);
    },
    onSuccess: async (_data, { projectId }) => {
      await queryClient.invalidateQueries({ queryKey: modelsKey(projectId) });
    },
  });
}
