'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateModel } from '@/lib/api/models';
import type { Model, ModelUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelKey, modelsKey } from './queryKeys';

type UpdateInput = {
  projectId: string;
  modelId: string;
  input: ModelUpdateInput;
};

export function useUpdateModel(): UseMutationResult<Model, Error, UpdateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId, input }) =>
      updateModel(accessToken, projectId, modelId, input),
    invalidateKeys: ({ projectId, modelId }) => [
      modelsKey(projectId),
      modelKey(projectId, modelId),
    ],
  });
}
