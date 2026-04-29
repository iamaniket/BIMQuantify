'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { uploadFileEnd2End } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelFilesKey, modelKey } from './queryKeys';

type UploadInput = {
  projectId: string;
  modelId: string;
  file: File;
};

export function useUploadModelFile(): UseMutationResult<ProjectFile, Error, UploadInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<ProjectFile, Error, UploadInput>({
    mutationFn: async ({ projectId, modelId, file }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return uploadFileEnd2End(accessToken, projectId, modelId, file);
    },
    onSuccess: async (_data, { projectId, modelId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: modelFilesKey(projectId, modelId) }),
        queryClient.invalidateQueries({ queryKey: modelKey(projectId, modelId) }),
      ]);
    },
  });
}
