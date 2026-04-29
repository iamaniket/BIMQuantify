'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listProjectFiles } from '@/lib/api/projectFiles';
import type { ProjectFileList, ProjectFileStatusValue } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectFilesKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useProjectFiles(
  projectId: string,
  status: ProjectFileStatusValue | 'all' = 'ready',
): UseQueryResult<ProjectFileList> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: [...projectFilesKey(projectId), status] as const,
    queryFn: async (): Promise<ProjectFileList> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return listProjectFiles(accessToken, projectId, status);
    },
    enabled: accessToken !== null && projectId.length > 0,
    // While any file in the list has an in-flight extraction, refetch every
    // 3 seconds so the UI shows the queued → running → succeeded transition
    // without requiring the user to refresh manually.
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
