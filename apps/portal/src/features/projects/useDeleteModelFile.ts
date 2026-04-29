'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { deleteProjectFile } from '@/lib/api/projectFiles';
import { useAuth } from '@/providers/AuthProvider';

import { modelFilesKey } from './queryKeys';

type DeleteInput = {
  projectId: string;
  modelId: string;
  fileId: string;
};

export function useDeleteModelFile(): UseMutationResult<undefined, Error, DeleteInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<undefined, Error, DeleteInput>({
    mutationFn: async ({ projectId, modelId, fileId }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      await deleteProjectFile(accessToken, projectId, modelId, fileId);
      return undefined;
    },
    onSuccess: async (_data, { projectId, modelId }) => {
      await queryClient.invalidateQueries({
        queryKey: modelFilesKey(projectId, modelId),
      });
    },
  });
}
