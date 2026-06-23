'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listFindings } from '@/lib/api/findings';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Finding } from '@/lib/api/schemas';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { findingsKey, projectFindingsKey } from './queryKeys';

export function useFindings(
  projectId: string,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  return useAuthInfiniteQuery({
    queryKey: findingsKey(projectId),
    queryFn: (accessToken, offset, limit) =>
      listFindings(accessToken, projectId, { limit, offset }),
  });
}

/** Project-level findings — those not linked to a 3D element. Shown in the
 * viewer inspector when no element is selected (mirrors useProjectAttachments). */
export function useProjectFindings(
  projectId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  return useAuthInfiniteQuery({
    queryKey: projectFindingsKey(projectId),
    queryFn: (accessToken, offset, limit) =>
      listFindings(accessToken, projectId, { unlinked: true, limit, offset }),
    enabled,
  });
}

/** File-scoped findings — those linked to a given file (e.g. a PDF document).
 * Shown in the viewer inspector when a PDF is open (no element to anchor to). */
export function useFileFindings(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  // An empty string is NOT a valid file id. In multi-model mode
  // `scope.activeFileId` is `''` until the manifest resolves; `'' !== null` is
  // true, so without this guard the query fires with `linked_file_id=` and 422s.
  const hasFile = fileId !== null && fileId !== '';
  return useAuthInfiniteQuery({
    queryKey: [...findingsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken, offset, limit) => {
      if (fileId === null || fileId === '') throw new Error('Missing fileId');
      return listFindings(accessToken, projectId, { linkedFileId: fileId, limit, offset });
    },
    enabled: hasFile,
  });
}

export function useFileFindingCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useFileFindings(projectId, fileId);
  return totalFromPages(query.data);
}
