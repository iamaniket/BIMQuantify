'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { retryExtraction } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelFilesKey, modelsWithVersionsKey } from './queryKeys';

type RetryArgs = { projectId: string; modelId: string; fileId: string };

export function useRetryExtraction(): UseMutationResult<ProjectFile, Error, RetryArgs> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId, fileId }) =>
      retryExtraction(accessToken, projectId, modelId, fileId),
    invalidateKeys: ({ projectId, modelId }) => [
      modelFilesKey(projectId, modelId),
      modelsWithVersionsKey(projectId),
    ],
  });
}
