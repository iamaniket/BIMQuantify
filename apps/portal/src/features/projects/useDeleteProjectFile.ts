'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { deleteProjectFile } from '@/lib/api/projectFiles';
import { useAuth } from '@/providers/AuthProvider';

import { projectFilesKey } from './queryKeys';

type DeleteInput = {
  projectId: string;
  fileId: string;
};

export function useDeleteProjectFile(): UseMutationResult<undefined, Error, DeleteInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<undefined, Error, DeleteInput>({
    mutationFn: async ({ projectId, fileId }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      await deleteProjectFile(accessToken, projectId, fileId);
      return undefined;
    },
    onSuccess: async (_data, { projectId }) => {
      await queryClient.invalidateQueries({ queryKey: projectFilesKey(projectId) });
    },
  });
}
