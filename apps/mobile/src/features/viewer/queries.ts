import {
  getViewerBundle,
  toViewerBundle,
  type EmbedViewerBundle,
} from '@/lib/api/viewerBundle';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

/**
 * Fetches a file's viewer bundle and maps it to the camelCase `EmbedViewerBundle`
 * the WebView consumes. Resolves to null for a non-IFC file (no fragments).
 */
export function useViewerBundle(projectId: string, modelId: string, fileId: string) {
  return useAuthQuery<EmbedViewerBundle | null>(
    ['viewer', 'bundle', projectId, modelId, fileId],
    async (token) =>
      toViewerBundle(await getViewerBundle(token, projectId, modelId, fileId), fileId),
    {
      enabled: projectId.length > 0 && modelId.length > 0 && fileId.length > 0,
    },
  );
}
