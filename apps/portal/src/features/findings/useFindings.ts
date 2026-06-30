'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { useViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
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
 * Free-aware: free snags are CONTAINER-scoped (the pooled endpoint is
 * `/free/documents/{containerId}/findings`), NOT file-scoped. In the free viewer
 * the container is the single-mode selection target's `modelId` (the `fileId`
 * arg is the head file — used for 3D marker scene ids, not the findings query),
 * so we resolve it from the same selection store the viewer scope reads. Without
 * this the request would hit `/free/documents/{fileId}/findings` → 404 and the
 * free viewer's markers never render. */
export function useFileFindings(
  projectId: string,
  fileId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  const { isFreeUser, ready } = useIsFreeUser();
  const target = useViewerTarget(projectId);
  // For free, the container id (free_document_id) is the open single-mode target's
  // modelId; fall back to fileId defensively (paid ignores this entirely).
  const freeContainerId =
    target.kind === 'single' && target.modelId !== '' ? target.modelId : fileId;
  // An empty string is NOT a valid file id. In multi-model mode
  // `scope.activeFileId` is `''` until the manifest resolves; `'' !== null` is
  // true, so without this guard the query fires with `linked_file_id=` and 422s.
  const hasFile = fileId !== null && fileId !== '';
  return useAuthInfiniteQuery({
    queryKey: [
      ...findingsKey(projectId),
      'file',
      fileId ?? '',
      // Free findings cache by container, not file, so two files of the same
      // container share results; '' keeps the paid key shape unchanged.
      isFreeUser ? `c:${freeContainerId ?? ''}` : '',
    ] as const,
    queryFn: isFreeUser
      ? async (accessToken) => {
          if (freeContainerId === null || freeContainerId === '') {
            throw new Error('Missing container');
          }
          const snags = await listFreeFindings(accessToken, freeContainerId);
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
