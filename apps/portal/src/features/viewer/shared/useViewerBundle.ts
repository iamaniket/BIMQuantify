'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getViewerBundle } from '@/lib/api/projectFiles';
import type { ViewerBundleResponse } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { viewerKeys } from './queryKeys';

/**
 * Fetch the viewer bundle (presigned artifact URLs incl. `file_url` for PDFs)
 * for a specific model+file. Standalone wrapper around `getViewerBundle` —
 * `useViewerScope` fetches the *active* bundle internally; this is for ad-hoc
 * bundles (the calibration PDF pane and the FloorPlanPane sheet substitution).
 */
export function useViewerBundle(
  projectId: string,
  modelId: string,
  fileId: string,
): UseQueryResult<ViewerBundleResponse> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  return useQuery({
    queryKey: viewerKeys.bundle(projectId, modelId, fileId),
    queryFn: () => {
      if (accessToken === null) throw new Error('Not authenticated');
      return getViewerBundle(accessToken, projectId, modelId, fileId);
    },
    enabled:
      projectId.length > 0 &&
      modelId.length > 0 &&
      fileId.length > 0 &&
      accessToken !== null,
    staleTime: 60_000,
  });
}
