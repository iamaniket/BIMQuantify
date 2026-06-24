import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { ApiError } from '@/lib/api/client';
import { getFinding, listFindings, createFinding } from '@/lib/api/findings';
import { tokenManager } from '@/lib/api/tokenManager';
import type { Finding, FindingCreateInput } from '@/lib/api/schemas/findings';
import { useOfflineItemQuery, useOfflineListQuery } from '@/lib/query/useOfflineQuery';
import { putOne } from '@/lib/offline/cache';
import { getNetworkStatus } from '@/lib/offline/networkStatus';
import { enqueue } from '@/lib/offline/outbox';
import { buildOptimisticFinding } from '@/features/findings/offline';
import { useAuth } from '@/providers/AuthProvider';
import { useOffline } from '@/providers/OfflineProvider';

export function useProjectFindings(projectId: string) {
  return useOfflineListQuery<Finding>(
    ['projects', projectId, 'findings'],
    'finding',
    projectId,
    (token) => listFindings(token, projectId),
    { enabled: projectId.length > 0 },
  );
}

export function useFinding(projectId: string, findingId: string) {
  return useOfflineItemQuery<Finding>(
    ['projects', projectId, 'findings', findingId],
    'finding',
    projectId,
    findingId,
    (token) => getFinding(token, projectId, findingId),
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
  const offline = useOffline();
  const queryClient = useQueryClient();
  return useMutation<Finding, Error, FindingCreateInput>({
    networkMode: 'always',
    mutationFn: async (input) => {
      const idempotencyKey = Crypto.randomUUID();
      const token = tokens?.access_token ?? null;
      // If any photo is still queued (a temp id), the create must go through the
      // outbox too, so the engine can swap temp → real photo ids before the POST.
      const hasQueuedPhotos = (input.photo_ids ?? []).some((id) => id.startsWith('temp-photo-'));
      if (getNetworkStatus() && token !== null && !hasQueuedPhotos) {
        try {
          return await createFinding(token, projectId, input, idempotencyKey);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const fresh = await tokenManager.refresh();
            return await createFinding(fresh, projectId, input, idempotencyKey);
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
