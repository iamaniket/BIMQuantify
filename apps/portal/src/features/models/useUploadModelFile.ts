'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { uploadFileEnd2End, type UploadProgressEvent } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { modelFilesKey, modelKey, modelsKey, modelsWithVersionsKey } from './queryKeys';

type UploadInput = {
  projectId: string;
  modelId: string;
  file: File;
  onProgress?: (event: UploadProgressEvent) => void;
};

export function useUploadModelFile(): UseMutationResult<ProjectFile, Error, UploadInput> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, modelId, file, onProgress }) =>
      uploadFileEnd2End(accessToken, projectId, modelId, file, onProgress),
    invalidateKeys: ({ projectId, modelId }) => [
      modelFilesKey(projectId, modelId),
      modelKey(projectId, modelId),
      modelsWithVersionsKey(projectId),
      modelsKey(projectId),
    ],
    onSuccess: (file, vars) => {
      track(PORTAL_EVENTS.FILE_UPLOADED, {
        project_id: vars.projectId,
        model_id: vars.modelId,
        file_id: file.id,
        file_type: file.file_type,
        size_bytes: file.size_bytes,
      });
    },
  });
}
