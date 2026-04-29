'use client';

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { retryExtraction } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelFilesKey } from './queryKeys';

type RetryArgs = { projectId: string; modelId: string; fileId: string };

export function useRetryExtraction(): UseMutationResult<
  ProjectFile,
  Error,
  RetryArgs
  > {
  const queryClient = useQueryClient();
  const { tokens } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, modelId, fileId }: RetryArgs): Promise<ProjectFile> => {
      if (tokens === null) throw new Error('Not authenticated');
      return retryExtraction(tokens.access_token, projectId, modelId, fileId);
    },
    onSuccess: (_data, { projectId, modelId }) => {
      queryClient
        .invalidateQueries({ queryKey: modelFilesKey(projectId, modelId) })
        .catch(() => undefined);
    },
  });
}
