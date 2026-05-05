'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listProjectFiles } from '@/lib/api/projectFiles';
import type { ProjectFileList, ProjectFileStatusValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { modelFilesKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useModelFiles(
  projectId: string,
  modelId: string,
  status: ProjectFileStatusValue | 'all' = 'ready',
): UseQueryResult<ProjectFileList> {
  return useAuthQuery({
    queryKey: [...modelFilesKey(projectId, modelId), status] as const,
    queryFn: (accessToken) =>
      listProjectFiles(accessToken, projectId, modelId, status),
    enabled: projectId.length > 0 && modelId.length > 0,
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
