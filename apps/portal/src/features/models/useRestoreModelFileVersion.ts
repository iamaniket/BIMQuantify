'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { restoreModelFileVersion } from '@/lib/api/projectFiles';
import type { Model } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelFilesKey, modelKey, modelsKey, modelsWithVersionsKey } from './queryKeys';

type RestoreInput = {
  projectId: string;
  modelId: string;
  fileId: string;
};

/**
 * Restore an older model version as head (F7). Invalidates the same keys as
 * {@link useUploadModelFile} so the new `head_file_id` propagates: the version
 * timeline re-marks the current version and the view/compliance pills retarget.
 */
export function useRestoreModelFileVersion(): UseMutationResult<Model, Error, RestoreInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId, fileId }) =>
      restoreModelFileVersion(accessToken, projectId, modelId, fileId),
    invalidateKeys: ({ projectId, modelId }) => [
      modelFilesKey(projectId, modelId),
      modelKey(projectId, modelId),
      modelsWithVersionsKey(projectId),
      modelsKey(projectId),
    ],
  });
}
