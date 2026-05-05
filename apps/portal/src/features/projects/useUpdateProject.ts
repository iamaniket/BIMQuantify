'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateProject } from '@/lib/api/projects';
import type { Project, ProjectUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export type UpdateProjectArgs = {
  id: string;
  input: ProjectUpdateInput;
};

export function useUpdateProject(): UseMutationResult<Project, Error, UpdateProjectArgs> {
  return useAuthMutation({
    mutationFn: (accessToken, { id, input }) => updateProject(accessToken, id, input),
    invalidateKeys: [projectsKey],
  });
}
