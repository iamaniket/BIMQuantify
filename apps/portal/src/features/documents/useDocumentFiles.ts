'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listProjectFiles } from '@/lib/api/projectFiles';
import type { ProjectFileList, ProjectFileStatusValue } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentFilesKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useDocumentFiles(
  projectId: string,
  documentId: string,
  status: ProjectFileStatusValue | 'all' = 'ready',
): UseQueryResult<ProjectFileList> {
  return useAuthQuery({
    queryKey: [...documentFilesKey(projectId, documentId), status] as const,
    queryFn: (accessToken) =>
      listProjectFiles(accessToken, projectId, documentId, status),
    enabled: projectId.length > 0 && documentId.length > 0,
    refetchInterval: (query) => {
      // Stop polling once a poll errors (e.g. 401 + failed refresh). The query
      // settles to `error` but `state.data` keeps the last non-terminal snapshot,
      // so without this guard — and with the global `retry: false` — we'd fire
      // one doomed request per tick forever (#12).
      if (query.state.status === 'error') return false;
      const { data } = query.state;
      if (data === undefined) return false;
      const hasInFlight = data.some(
        (f) => f.extraction_status === 'queued' || f.extraction_status === 'running',
      );
      return hasInFlight ? POLL_INTERVAL_MS : false;
    },
  });
}
