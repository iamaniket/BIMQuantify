'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectKey } from './queryKeys';

export function useProject(id: string): UseQueryResult<Project> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: projectKey(id),
    queryFn: async (): Promise<Project> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return getProject(accessToken, id);
    },
    enabled: accessToken !== null && id.length > 0,
  });
}
