'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { uploadFileEnd2End, type UploadProgressEvent } from '@/lib/api/projectFiles';
import type { ProjectFile } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentFilesKey, documentKey, documentsKey, documentsWithVersionsKey } from './queryKeys';

type UploadInput = {
  projectId: string;
  documentId: string;
  file: File;
  onProgress?: (event: UploadProgressEvent) => void;
};

export function useUploadDocumentFile(): UseMutationResult<ProjectFile, Error, UploadInput> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, documentId, file, onProgress }) =>
      uploadFileEnd2End(accessToken, projectId, documentId, file, onProgress, isPooled),
    invalidateKeys: ({ projectId, documentId }) => [
      documentFilesKey(projectId, documentId),
      documentKey(projectId, documentId),
      documentsWithVersionsKey(projectId),
      documentsKey(projectId),
    ],
    onSuccess: (file, vars) => {
      track(PORTAL_EVENTS.FILE_UPLOADED, {
        project_id: vars.projectId,
        model_id: vars.documentId,
        file_id: file.id,
        file_type: file.file_type,
        size_bytes: file.size_bytes,
      });
    },
  });
}
