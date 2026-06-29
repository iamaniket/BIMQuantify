'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listDocumentsWithVersions } from '@/lib/api/documents';
import type { DocumentWithVersionsList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { documentsWithVersionsKey } from './queryKeys';

const POLL_INTERVAL_MS = 3_000;

export function useDocumentsWithVersions(
  projectId: string,
  /** When true, refetches every 3 s while any file is in-flight. */
  pollWhileExtracting = false,
): UseQueryResult<DocumentWithVersionsList> {
  // Free-aware: the free documents endpoint already returns the with-versions
  // shape (one synthetic version per pooled model).
  const { isFreeUser } = useIsFreeUser();
  return useAuthQuery({
    queryKey: documentsWithVersionsKey(projectId),
    queryFn: (accessToken) =>
      listDocumentsWithVersions(accessToken, projectId, isFreeUser),
    enabled: projectId.length > 0,
    refetchInterval: pollWhileExtracting
      ? (query) => {
          // Stop polling once a poll errors (e.g. 401 + failed refresh). The
          // query settles to `error` but `state.data` keeps the last
          // non-terminal snapshot, so without this guard — and with the global
          // `retry: false` — we'd fire one doomed request per tick forever (#12).
          if (query.state.status === 'error') return false;
          const documents = query.state.data;
          if (documents == null) return false;
          const hasInFlight = (documents).some((m) =>
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
