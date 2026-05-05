'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteProject } from '@/lib/api/projects';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export type DeleteProjectArgs = {
  id: string;
};

export function useDeleteProject(): UseMutationResult<void, Error, DeleteProjectArgs> {
  return useAuthMutation({
    mutationFn: (accessToken, { id }) => deleteProject(accessToken, id),
    invalidateKeys: [projectsKey],
  });
}
