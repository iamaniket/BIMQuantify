'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listProjects } from '@/lib/api/projects';
import type { ProjectList } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export function useProjects(): UseQueryResult<ProjectList> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: projectsKey,
    queryFn: async (): Promise<ProjectList> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return listProjects(accessToken);
    },
    enabled: accessToken !== null,
  });
}
