'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { reactivateProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

type ReactivateProjectArgs = {
  id: string;
};

export function useReactivateProject(): UseMutationResult<Project, Error, ReactivateProjectArgs> {
  return useAuthMutation({
    mutationFn: (accessToken, { id }) => reactivateProject(accessToken, id),
    invalidateKeys: [projectsKey],
  });
}
