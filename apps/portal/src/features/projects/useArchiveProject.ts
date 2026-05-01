'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { archiveProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

type ArchiveProjectArgs = {
  id: string;
};

export function useArchiveProject(): UseMutationResult<Project, Error, ArchiveProjectArgs> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, ArchiveProjectArgs>({
    mutationFn: async ({ id }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return archiveProject(accessToken, id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}