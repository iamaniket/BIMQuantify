import { useCallback, useState } from 'react';

import { useIsPooledContext } from '@/lib/hooks/useIsPooledContext';
import { getNetworkStatus } from '@/lib/offline/networkStatus';
import { enqueue } from '@/lib/offline/outbox';
import { useAuth } from '@/providers/AuthProvider';
import { useOffline } from '@/providers/OfflineProvider';

import { capturePhoto, type CaptureSource } from './capture';
import { uploadPhoto } from './upload';

export type PhotoItem = {
  localId: string;
  thumbnailUri: string;
  // 'queued' = captured offline, waiting in the outbox; remoteId is its temp id.
  status: 'uploading' | 'uploaded' | 'queued' | 'error';
  remoteId?: string;
  error?: string;
};

export type PhotoCapture = {
  photos: PhotoItem[];
  add: (source: CaptureSource) => Promise<void>;
  remove: (localId: string) => void;
  /** Real attachment ids of the photos that finished uploading. */
  photoIds: () => string[];
  /** True while any photo is still uploading. */
  isBusy: boolean;
};

/**
 * Capture photos and upload them immediately (online). Each photo becomes a
 * real `project_files` attachment whose id is folded into the finding's
 * `photo_ids` on save. Phase 5 adds the offline-queue branch; this is the
 * online path it builds on.
 */
export function usePhotoCapture(projectId: string): PhotoCapture {
  const { tokens } = useAuth();
  const isFree = useIsPooledContext();
  const offline = useOffline();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const add = useCallback(
    async (source: CaptureSource): Promise<void> => {
      const token = tokens?.access_token ?? null;
      const captured = await capturePhoto(source);
      if (captured === null) return;

      if (getNetworkStatus() && token !== null) {
        setPhotos((prev) => [
          ...prev,
          { localId: captured.localId, thumbnailUri: captured.thumbnailUri, status: 'uploading' },
        ]);
        try {
          const remoteId = await uploadPhoto(token, projectId, captured, isFree);
          setPhotos((prev) =>
            prev.map((p) =>
              p.localId === captured.localId ? { ...p, status: 'uploaded', remoteId } : p,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Upload failed';
          setPhotos((prev) =>
            prev.map((p) =>
              p.localId === captured.localId ? { ...p, status: 'error', error: message } : p,
            ),
          );
        }
        return;
      }

      // Offline: queue the upload; the finding references the temp id, which the
      // sync engine swaps for the real attachment id when it uploads.
      const tempPhotoId = `temp-photo-${captured.localId}`;
      await enqueue({
        tempId: tempPhotoId,
        idempotencyKey: captured.localId,
        kind: 'upload_photo',
        scope: projectId,
        payload: { photo: captured },
      });
      await offline.refresh();
      setPhotos((prev) => [
        ...prev,
        {
          localId: captured.localId,
          thumbnailUri: captured.thumbnailUri,
          status: 'queued',
          remoteId: tempPhotoId,
        },
      ]);
    },
    [tokens, projectId, offline, isFree],
  );

  const remove = useCallback((localId: string): void => {
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
  }, []);

  const photoIds = useCallback(
    (): string[] =>
      photos
        .filter(
          (p): p is PhotoItem & { remoteId: string } =>
            (p.status === 'uploaded' || p.status === 'queued') && p.remoteId !== undefined,
        )
        .map((p) => p.remoteId),
    [photos],
  );

  const isBusy = photos.some((p) => p.status === 'uploading');

  return { photos, add, remove, photoIds, isBusy };
}
