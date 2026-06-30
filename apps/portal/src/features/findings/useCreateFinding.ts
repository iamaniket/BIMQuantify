'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useViewerTarget } from '@/features/viewer/shared/viewerSelectionStore';
import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { createFinding } from '@/lib/api/findings';
import { createFreeFinding } from '@/lib/api/freeFindings';
import type { Finding, FindingCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

/** Thrown when a free finding is created without a container to attach it to.
 * Free snags require a non-null `free_document_id`, so the caller must resolve a
 * container (`linked_document_id`) first (the viewer has one; the board picks one). */
export class FreeFindingNoContainerError extends Error {
  constructor() {
    super('FREE_FINDING_NO_CONTAINER');
    this.name = 'FreeFindingNoContainerError';
  }
}

/**
 * Free-aware: on the free tier a "finding" is a pooled snag created against a
 * container via `POST /pooled/documents/{containerId}/findings`. We map the container
 * from `input.linked_document_id` (the viewer/board supplies it) and translate
 * the paid create payload to the free snag shape. Assignment + deadline are NOT
 * part of the create contract (mirrors paid — set them afterwards via the detail
 * form / `useUpdateFinding`). The result is adapted back to the paid `Finding`
 * shape so the shared finding components render it unchanged.
 */
export function useCreateFinding(
  projectId: string,
): UseMutationResult<Finding, Error, FindingCreateInput> {
  const { isFreeUser } = useIsFreeUser();
  // Free snags MUST hang off a container (free_document_id). A pinned 3D finding
  // carries it as `linked_document_id`; an unpinned / PDF-page / project-level
  // create does not, so fall back to the open viewer container (the single-mode
  // selection target's modelId). Without this, PDF and unpinned creates threw
  // FreeFindingNoContainerError and never posted.
  const target = useViewerTarget(projectId);
  const fallbackContainerId =
    target.kind === 'single' && target.modelId !== '' ? target.modelId : null;
  return useAuthMutation({
    mutationFn: async (accessToken, input) => {
      if (isFreeUser) {
        const containerId =
          input.linked_document_id != null && input.linked_document_id !== ''
            ? input.linked_document_id
            : fallbackContainerId;
        if (containerId == null || containerId === '') {
          throw new FreeFindingNoContainerError();
        }
        // The free create endpoint already returns the paid `Finding` shape.
        return createFreeFinding(accessToken, containerId, {
          title: input.title,
          note: input.description ?? null,
          severity: input.severity,
          linked_file_type: input.linked_file_type ?? 'ifc',
          linked_file_id: input.linked_file_id ?? null,
          anchor_x: input.anchor_x ?? null,
          anchor_y: input.anchor_y ?? null,
          anchor_z: input.anchor_z ?? null,
          anchor_page: input.anchor_page ?? null,
          linked_element_global_id: input.linked_element_global_id ?? null,
        });
      }
      return createFinding(accessToken, projectId, input);
    },
    invalidateKeys: [findingsKey(projectId)],
  });
}
