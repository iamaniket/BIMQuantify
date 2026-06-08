'use client';

import type { UseMutationResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { Attachment } from '@/lib/api/schemas';
import { useNetworkStatus } from '@/lib/offline/networkStatus.js';
import { storePhotoOffline, type OfflinePhotoResult } from '@/lib/offline/photoStore.js';

import { useUploadAttachment } from '../attachments/useUploadAttachment.js';

// ---------------------------------------------------------------------------
// Offline-aware photo upload
// ---------------------------------------------------------------------------

export interface OfflineUploadVars {
  file: File;
  captureMetadata?: Record<string, unknown> | null;
}

export interface OfflineUploadResult {
  id: string;
  isLocal: boolean;
  thumbnailUrl?: string;
}

export function useOfflinePhotoUpload(
  projectId: string,
  momentId: string,
): {
  upload: (vars: OfflineUploadVars) => Promise<OfflineUploadResult>;
  isPending: boolean;
} {
  const { isOnline } = useNetworkStatus();
  const onlineMutation = useUploadAttachment(projectId);
  const [offlinePending, setOfflinePending] = useState(false);

  const upload = useCallback(
    async (vars: OfflineUploadVars): Promise<OfflineUploadResult> => {
      if (isOnline) {
        const result = await onlineMutation.mutateAsync({ file: vars.file, capture_metadata: vars.captureMetadata ?? null });
        return { id: result.id, isLocal: false };
      }

      setOfflinePending(true);
      try {
        const offlineResult = await storePhotoOffline(
          projectId,
          momentId,
          vars.file,
          vars.captureMetadata,
        );
        return {
          id: offlineResult.tempPhotoId,
          isLocal: true,
          thumbnailUrl: offlineResult.thumbnailUrl,
        };
      } finally {
        setOfflinePending(false);
      }
    },
    [isOnline, onlineMutation, projectId, momentId],
  );

  return {
    upload,
    isPending: isOnline ? onlineMutation.isPending : offlinePending,
  };
}
