'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { archiveProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

type ArchiveProjectArgs = {
  id: string;
};

export function useArchiveProject(): UseMutationResult<Project, Error, ArchiveProjectArgs> {
  return useAuthMutation({
    mutationFn: (accessToken, { id }) => archiveProject(accessToken, id),
    invalidateKeys: [projectsKey],
  });
}
