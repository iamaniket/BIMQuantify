'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectKey } from './queryKeys';

export function useProject(id: string): UseQueryResult<Project> {
  return useAuthQuery({
    queryKey: projectKey(id),
    queryFn: (accessToken) => getProject(accessToken, id),
    enabled: id.length > 0,
  });
}
