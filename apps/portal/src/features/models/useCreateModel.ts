'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createModel } from '@/lib/api/models';
import type { Model, ModelCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelsKey } from './queryKeys';

type CreateInput = { projectId: string; input: ModelCreateInput };

export function useCreateModel(): UseMutationResult<Model, Error, CreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      createModel(accessToken, projectId, input),
    invalidateKeys: ({ projectId }) => [modelsKey(projectId)],
  });
}
