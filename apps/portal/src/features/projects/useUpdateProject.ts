'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { updateProject } from '@/lib/api/projects';
import type { Project, ProjectUpdateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export type UpdateProjectArgs = {
  id: string;
  input: ProjectUpdateInput;
};

export function useUpdateProject(): UseMutationResult<Project, Error, UpdateProjectArgs> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, UpdateProjectArgs>({
    mutationFn: async ({ id, input }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return updateProject(accessToken, id, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
