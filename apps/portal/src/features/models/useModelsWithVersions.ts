'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listModelsWithVersions } from '@/lib/api/models';
import type { ModelWithVersionsList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { modelsWithVersionsKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useModelsWithVersions(
  projectId: string,
  /** When true, refetches every 3 s while any file is in-flight. */
  pollWhileExtracting = false,
): UseQueryResult<ModelWithVersionsList> {
  return useAuthQuery({
    queryKey: modelsWithVersionsKey(projectId),
    queryFn: (accessToken) => listModelsWithVersions(accessToken, projectId),
    enabled: projectId.length > 0,
    refetchInterval: pollWhileExtracting
      ? (query) => {
          const models = query.state.data;
          if (models == null) return false;
          const hasInFlight = (models as ModelWithVersionsList).some((m) =>
            m.versions.some(
              (f: { extraction_status: string }) =>
                f.extraction_status === 'queued' || f.extraction_status === 'running',
            ),
          );
          return hasInFlight ? POLL_INTERVAL_MS : false;
        }
      : false,
  });
}
