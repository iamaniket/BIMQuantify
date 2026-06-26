'use client';

import type { UseQueryResult } from '@tanstack/react-query';

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
  return useAuthQuery({
    queryKey: documentsWithVersionsKey(projectId),
    queryFn: (accessToken) => listDocumentsWithVersions(accessToken, projectId),
    enabled: projectId.length > 0,
    refetchInterval: pollWhileExtracting
      ? (query) => {
          const documents = query.state.data;
          if (documents == null) return false;
          const hasInFlight = (documents as DocumentWithVersionsList).some((m) =>
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
