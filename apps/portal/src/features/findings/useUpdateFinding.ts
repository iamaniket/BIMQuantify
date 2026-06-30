'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { updateFinding } from '@/lib/api/findings';
import { updatePooledFinding } from '@/lib/api/pooledFindings';
import type { Finding, FindingUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

type Vars = { findingId: string; input: FindingUpdateInput };

/**
 * Free-aware: on the free board a "finding" is a pooled snag, so updates go to
 * `PATCH /pooled/findings/{id}` (title/note/severity/status + assignee/deadline). The
 * result is adapted back to the paid `Finding` shape so the kanban (which
 * refetches from the board feed) is unchanged.
 */
export function useUpdateFinding(projectId: string): UseMutationResult<Finding, Error, Vars> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: async (accessToken, { findingId, input }) => {
      if (isPooled) {
        // The free update endpoint already returns the paid `Finding` shape.
        return updatePooledFinding(accessToken, findingId, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { note: input.description } : {}),
          ...(input.severity != null ? { severity: input.severity } : {}),
          ...(input.status != null ? { status: input.status } : {}),
          ...(input.assignee_user_id !== undefined
            ? { assigned_to_user_id: input.assignee_user_id }
            : {}),
          ...(input.deadline_date !== undefined
            ? { deadline_date: input.deadline_date }
            : {}),
          ...(input.photo_ids !== undefined ? { photo_ids: input.photo_ids } : {}),
          ...(input.resolution_evidence_ids !== undefined
            ? { resolution_evidence_ids: input.resolution_evidence_ids }
            : {}),
        });
      }
      return updateFinding(accessToken, projectId, findingId, input);
    },
    invalidateKeys: [findingsKey(projectId)],
  });
}
