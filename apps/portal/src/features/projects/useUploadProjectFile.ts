'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { uploadFileEnd2End } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectFilesKey } from './queryKeys';

type UploadInput = {
  projectId: string;
  file: File;
};

export function useUploadProjectFile(): UseMutationResult<ProjectFile, Error, UploadInput> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<ProjectFile, Error, UploadInput>({
    mutationFn: async ({ projectId, file }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return uploadFileEnd2End(accessToken, projectId, file);
    },
    onSuccess: async (_data, { projectId }) => {
      await queryClient.invalidateQueries({ queryKey: projectFilesKey(projectId) });
    },
  });
}
