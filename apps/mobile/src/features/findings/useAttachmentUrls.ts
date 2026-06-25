import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';
import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import { tokenManager } from '@/lib/api/tokenManager';
import { useNetworkStatus } from '@/lib/offline/networkStatus';
import { useAuth } from '@/providers/AuthProvider';

/**
 * Resolve attachment ids → short-lived presigned download URLs for display.
 * Online-only (presigned MinIO URLs need network); temp ids from a not-yet-synced
 * offline finding are skipped. Returns an id → url map.
 */
export function useAttachmentUrls(
  projectId: string,
  ids: string[],
): UseQueryResult<Record<string, string>, Error> {
  const { tokens } = useAuth();
  const token = tokens?.access_token ?? null;
  const online = useNetworkStatus();
  // Drop client temp ids (a queued offline photo has no server object yet).
  const realIds = ids.filter((id) => !id.startsWith('temp'));

  return useQuery<Record<string, string>, Error>({
    queryKey: ['attachments', projectId, 'urls', realIds.join(',')],
    enabled: token !== null && online && realIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (token === null) throw new Error('Not authenticated');
      const fetchOne = async (id: string): Promise<readonly [string, string]> => {
        try {
          const res = await getAttachmentDownloadUrl(token, projectId, id);
          return [id, res.download_url] as const;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            const fresh = await tokenManager.refresh();
            const res = await getAttachmentDownloadUrl(fresh, projectId, id);
            return [id, res.download_url] as const;
          }
          throw error;
        }
      };
      const entries = await Promise.all(realIds.map(fetchOne));
      return Object.fromEntries(entries);
    },
  });
}
