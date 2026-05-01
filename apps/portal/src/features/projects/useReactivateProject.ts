'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { reactivateProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

type ReactivateProjectArgs = {
  id: string;
};

export function useReactivateProject(): UseMutationResult<Project, Error, ReactivateProjectArgs> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, ReactivateProjectArgs>({
    mutationFn: async ({ id }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return reactivateProject(accessToken, id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}