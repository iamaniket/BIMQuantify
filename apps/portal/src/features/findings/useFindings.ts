'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listFindings } from '@/lib/api/findings';
import { listFreeProjectSnags } from '@/lib/api/freeProjects';
import { freeFindingToFinding, listFreeFindings } from '@/lib/api/freeFindings';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Finding } from '@/lib/api/schemas';
import { useAuthInfiniteQuery, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { findingsKey, projectFindingsKey } from './queryKeys';

/**
 * Free-aware: the free board feed (`/free/projects/{id}/findings`) returns every
 * snag as a single un-paginated `Finding[]`, so we wrap it as one page. The
 * paid path keeps its real offset/limit pagination.
 */
export function useFindings(
  projectId: string,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthInfiniteQuery({
    queryKey: findingsKey(projectId),
    queryFn: isFreeUser
      ? async (accessToken) => {
          const data = await listFreeProjectSnags(accessToken, projectId);
          return { data, totalCount: data.length };
        }
      : (accessToken, offset, limit) =>
          listFindings(accessToken, projectId, { limit, offset }),
    // Gated on `ready`: until /auth/me resolves, `isFreeUser` is false and a free
    // user would hit the org-only paid `/projects/{id}/findings` endpoint → 409.
    enabled: ready,
  });
}

/** Project-level findings — those not linked to a 3D element. Shown in the
 * viewer inspector when no element is selected (mirrors useProjectAttachments).
 * Free-aware: the free board feed is unpaginated; "project-level" = snags with no
 * element/anchor, filtered client-side. */
export function useProjectFindings(
  projectId: string,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthInfiniteQuery({
    queryKey: projectFindingsKey(projectId),
    queryFn: isFreeUser
      ? async (accessToken) => {
          const all = await listFreeProjectSnags(accessToken, projectId);
          const data = all.filter(
            (f) => f.linked_element_global_id == null && f.anchor_x == null,
          );
          return { data, totalCount: data.length };
        }
      : (accessToken, offset, limit) =>
          listFindings(accessToken, projectId, { unlinked: true, limit, offset }),
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && enabled,
  });
}

/** File-scoped findings — those linked to a given file (e.g. a PDF document).
 * Shown in the viewer inspector when a PDF is open (no element to anchor to).
 * Free-aware: free snags key on the CONTAINER (free_document_id), so the free
 * viewer passes the container id here and we list that container's snags. */
export function useFileFindings(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  const { isFreeUser, ready } = useIsFreeUser();
  // An empty string is NOT a valid file id. In multi-model mode
  // `scope.activeFileId` is `''` until the manifest resolves; `'' !== null` is
  // true, so without this guard the query fires with `linked_file_id=` and 422s.
  const hasFile = fileId !== null && fileId !== '';
  return useAuthInfiniteQuery({
    queryKey: [...findingsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: isFreeUser
      ? async (accessToken) => {
          if (fileId === null || fileId === '') throw new Error('Missing fileId');
          const snags = await listFreeFindings(accessToken, fileId);
          const nowIso = new Date().toISOString();
          const data = snags.map((s) => freeFindingToFinding(s, projectId, nowIso));
          return { data, totalCount: data.length };
        }
      : (accessToken, offset, limit) => {
          if (fileId === null || fileId === '') throw new Error('Missing fileId');
          return listFindings(accessToken, projectId, { linkedFileId: fileId, limit, offset });
        },
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && hasFile,
  });
}

export function useFileFindingCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useFileFindings(projectId, fileId);
  return totalFromPages(query.data);
}
