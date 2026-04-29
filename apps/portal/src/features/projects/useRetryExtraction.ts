'use client';

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { retryExtraction } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectFilesKey } from './queryKeys';

type RetryArgs = { projectId: string; fileId: string };

export function useRetryExtraction(): UseMutationResult<
  ProjectFile,
  Error,
  RetryArgs
  > {
  const queryClient = useQueryClient();
  const { tokens } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, fileId }: RetryArgs): Promise<ProjectFile> => {
      if (tokens === null) throw new Error('Not authenticated');
      return retryExtraction(tokens.access_token, projectId, fileId);
    },
    onSuccess: (_data, { projectId }) => {
      queryClient
        .invalidateQueries({ queryKey: projectFilesKey(projectId) })
        .catch(() => undefined);
    },
  });
}
