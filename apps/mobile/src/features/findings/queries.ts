import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { ApiError } from '@/lib/api/client';
import { getFinding, listFindings, createFinding, updateFinding } from '@/lib/api/findings';
import {
  createFreeFinding,
  getFreeFinding,
  listFreeProjectFindings,
  updateFreeFinding,
} from '@/lib/api/freeFindings';
import { useIsFree } from '@/lib/hooks/useIsFree';
import { tokenManager } from '@/lib/api/tokenManager';
import type { Finding, FindingCreateInput, FindingUpdateInput } from '@/lib/api/schemas/findings';
import { useOfflineItemQuery, useOfflineListQuery } from '@/lib/query/useOfflineQuery';
import { putOne } from '@/lib/offline/cache';
import { getNetworkStatus } from '@/lib/offline/networkStatus';
import { enqueue } from '@/lib/offline/outbox';
import { buildOptimisticFinding } from '@/features/findings/offline';
import { useAuth } from '@/providers/AuthProvider';
import { useOffline } from '@/providers/OfflineProvider';

export function useProjectFindings(projectId: string) {
  const isFree = useIsFree();
  return useOfflineListQuery<Finding>(
    ['projects', projectId, 'findings'],
    'finding',
    projectId,
    (token) =>
      isFree ? listFreeProjectFindings(token, projectId) : listFindings(token, projectId),
    { enabled: projectId.length > 0 },
  );
}

export function useFinding(projectId: string, findingId: string) {
  const isFree = useIsFree();
  return useOfflineItemQuery<Finding>(
    ['projects', projectId, 'findings', findingId],
    'finding',
    projectId,
    findingId,
    (token) =>
      isFree
        ? getFreeFinding(token, projectId, findingId)
        : getFinding(token, projectId, findingId),
    { enabled: projectId.length > 0 && findingId.length > 0 },
  );
}

/**
 * Create a finding, offline-capable. Online: POST directly so validation errors
 * surface immediately. Offline (or if connectivity drops mid-request): enqueue
 * with a stable Idempotency-Key + an optimistic cached row, and resolve right
 * away — the sync engine replays it on reconnect (deduped server-side).
 */
export function useCreateFindingMutation(projectId: string) {
  const { tokens, me } = useAuth();
  const isFree = useIsFree();
  const offline = useOffline();
  const queryClient = useQueryClient();
  return useMutation<Finding, Error, FindingCreateInput>({
    networkMode: 'always',
    mutationFn: async (input) => {
      const idempotencyKey = Crypto.randomUUID();
      const token = tokens?.access_token ?? null;
      const doCreate = (t: string): Promise<Finding> =>
        isFree
          ? createFreeFinding(t, projectId, input, idempotencyKey)
          : createFinding(t, projectId, input, idempotencyKey);
      // If any photo is still queued (a temp id), the create must go through the
      // outbox too, so the engine can swap temp → real photo ids before the POST.
      const hasQueuedPhotos = (input.photo_ids ?? []).some((id) => id.startsWith('temp-photo-'));
      if (getNetworkStatus() && token !== null && !hasQueuedPhotos) {
        try {
          return await doCreate(token);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const fresh = await tokenManager.refresh();
            return await doCreate(fresh);
          }
          // A real HTTP error (e.g. 422 validation) surfaces to the caller; only
          // a connectivity failure falls through to the offline queue. The same
          // key is reused so a create that reached the server before the
          // connection dropped is deduped on replay.
          if (error instanceof ApiError) throw error;
        }
      }
      const tempId = `temp-${Crypto.randomUUID()}`;
      const optimistic = buildOptimisticFinding(input, tempId, projectId, me?.user.id);
      await enqueue({
        tempId,
        idempotencyKey,
        kind: 'create_finding',
        scope: projectId,
        payload: { input },
      });
      await putOne('finding', projectId, optimistic);
      await offline.refresh();
      return optimistic;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'findings'] });
    },
  });
}

type UpdateVars = { finding: Finding; input: FindingUpdateInput };

/** Apply only the fields actually present in the patch onto the cached row, so an
 * offline edit shows immediately without clobbering untouched fields. */
function mergeFinding(finding: Finding, input: FindingUpdateInput): Finding {
  const patched: Finding = { ...finding };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (patched as Record<string, unknown>)[key] = value;
    }
  }
  patched.updated_at = new Date().toISOString();
  return patched;
}

/**
 * Update a finding (status transition + resolution evidence), offline-capable.
 * Online: PATCH directly so the server gates (illegal transition / missing
 * evidence / inspector-only verify) surface as errors. Offline (or if evidence
 * photos are still queued): enqueue an `update_finding` and patch the cache
 * optimistically. The sync engine replays it; a transition that's no longer
 * legal on replay is parked as a conflict (server wins).
 */
export function useUpdateFindingMutation(projectId: string) {
  const { tokens } = useAuth();
  const isFree = useIsFree();
  const offline = useOffline();
  const queryClient = useQueryClient();
  return useMutation<Finding, Error, UpdateVars>({
    networkMode: 'always',
    mutationFn: async ({ finding, input }) => {
      const token = tokens?.access_token ?? null;
      const doUpdate = (t: string): Promise<Finding> =>
        isFree
          ? updateFreeFinding(t, projectId, finding.id, input)
          : updateFinding(t, projectId, finding.id, input);
      const hasQueuedEvidence = (input.resolution_evidence_ids ?? []).some((id) =>
        id.startsWith('temp-photo-'),
      );
      if (getNetworkStatus() && token !== null && !hasQueuedEvidence) {
        try {
          return await doUpdate(token);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const fresh = await tokenManager.refresh();
            return await doUpdate(fresh);
          }
          // A real HTTP error (422 illegal transition / missing evidence, 403
          // verify-not-inspector) surfaces to the caller; only a connectivity
          // failure falls through to the offline queue.
          if (error instanceof ApiError) throw error;
        }
      }
      const tempId = `temp-update-${Crypto.randomUUID()}`;
      await enqueue({
        tempId,
        idempotencyKey: Crypto.randomUUID(),
        kind: 'update_finding',
        scope: projectId,
        payload: { findingId: finding.id, input },
        baseUpdatedAt: finding.updated_at,
      });
      const optimistic = mergeFinding(finding, input);
      await putOne('finding', projectId, optimistic);
      await offline.refresh();
      return optimistic;
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'findings'] });
      void queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'findings', updated.id],
      });
    },
  });
}
