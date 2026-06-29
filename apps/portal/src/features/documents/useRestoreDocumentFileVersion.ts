'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { restoreModelFileVersion } from '@/lib/api/projectFiles';
import type { Document } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { documentFilesKey, documentKey, documentsKey, documentsWithVersionsKey } from './queryKeys';

type RestoreInput = {
  projectId: string;
  documentId: string;
  fileId: string;
};

/**
 * Restore an older document version as head (F7). Invalidates the same keys as
 * {@link useUploadDocumentFile} so the new `head_file_id` propagates: the version
 * timeline re-marks the current version and the view/compliance pills retarget.
 */
export function useRestoreDocumentFileVersion(): UseMutationResult<Document, Error, RestoreInput> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, documentId, fileId }) =>
      restoreModelFileVersion(accessToken, projectId, documentId, fileId, isFreeUser),
    invalidateKeys: ({ projectId, documentId }) => [
      documentFilesKey(projectId, documentId),
      documentKey(projectId, documentId),
      documentsWithVersionsKey(projectId),
      documentsKey(projectId),
    ],
  });
}
