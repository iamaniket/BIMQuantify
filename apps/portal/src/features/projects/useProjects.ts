'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listProjects } from '@/lib/api/projects';
import type { ProjectList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export function useProjects(): UseQueryResult<ProjectList> {
  return useAuthQuery({
    queryKey: projectsKey,
    queryFn: (accessToken) => listProjects(accessToken),
  });
}
