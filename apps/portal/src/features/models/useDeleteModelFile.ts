'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteProjectFile } from '@/lib/api/projectFiles';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelFilesKey } from './queryKeys';

type DeleteInput = {
  projectId: string;
  modelId: string;
  fileId: string;
};

export function useDeleteModelFile(): UseMutationResult<void, Error, DeleteInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId, fileId }) =>
      deleteProjectFile(accessToken, projectId, modelId, fileId),
    invalidateKeys: ({ projectId, modelId }) => [modelFilesKey(projectId, modelId)],
  });
}
