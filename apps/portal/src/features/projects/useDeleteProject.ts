'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { deleteProject } from '@/lib/api/projects';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export type DeleteProjectArgs = {
  id: string;
};

export function useDeleteProject(): UseMutationResult<undefined, Error, DeleteProjectArgs> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<undefined, Error, DeleteProjectArgs>({
    mutationFn: async ({ id }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      await deleteProject(accessToken, id);
      return undefined;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
