'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listProjectFiles } from '@/lib/api/projectFiles';
import type { ProjectFileList, ProjectFileStatusValue } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelFilesKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useModelFiles(
  projectId: string,
  modelId: string,
  status: ProjectFileStatusValue | 'all' = 'ready',
): UseQueryResult<ProjectFileList> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: [...modelFilesKey(projectId, modelId), status] as const,
    queryFn: async (): Promise<ProjectFileList> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return listProjectFiles(accessToken, projectId, modelId, status);
    },
    enabled:
      accessToken !== null && projectId.length > 0 && modelId.length > 0,
    refetchInterval: (query) => {
      const { data } = query.state;
      if (data === undefined) return false;
      const hasInFlight = data.some(
        (f) => f.extraction_status === 'queued' || f.extraction_status === 'running',
      );
      return hasInFlight ? POLL_INTERVAL_MS : false;
    },
  });
}
