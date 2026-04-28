'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { createProject } from '@/lib/api/projects';
import type { Project, ProjectCreateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export function useCreateProject(): UseMutationResult<Project, Error, ProjectCreateInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, ProjectCreateInput>({
    mutationFn: async (input) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return createProject(accessToken, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
