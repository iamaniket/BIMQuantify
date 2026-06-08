import { computeFileSha256 } from '@/lib/upload/sha256.js';

import { enqueueAction } from './queue.js';
import type { UploadPhotoEntry } from './types.js';

// ---------------------------------------------------------------------------
// Thumbnail generation (200px max, JPEG 0.6)
// ---------------------------------------------------------------------------

function generateThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 200;
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
      } else {
        if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { reject(new Error('Canvas 2D context unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob === null) { reject(new Error('Thumbnail toBlob failed')); return; }
          resolve(blob);
        },
        'image/jpeg',
        0.6,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail'));
    };

    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Store a photo offline — returns a local temp UUID
// ---------------------------------------------------------------------------

export interface OfflinePhotoResult {
  tempPhotoId: string;
  thumbnailUrl: string;
}

export async function storePhotoOffline(
  projectId: string,
  momentId: string,
  file: File,
  captureMetadata?: Record<string, unknown> | null,
): Promise<OfflinePhotoResult> {
  const tempPhotoId = `temp-${crypto.randomUUID()}`;

  const [sha256, thumbnail] = await Promise.all([
    computeFileSha256(file),
    generateThumbnail(file),
  ]);

  const input: Omit<UploadPhotoEntry, 'id' | 'createdAt' | 'attempts' | 'status'> = {
    type: 'upload_photo',
    projectId,
    momentId,
    tempPhotoId,
    photoBlob: file,
    photoMeta: {
      filename: file.name,
      contentType: file.type === '' ? 'image/jpeg' : file.type,
      size: file.size,
      sha256,
      captureMetadata: captureMetadata ?? null,
    },
    thumbnail,
  };

  await enqueueAction(input);

  const thumbnailUrl = URL.createObjectURL(thumbnail);
  return { tempPhotoId, thumbnailUrl };
}

// ---------------------------------------------------------------------------
// IDB storage estimate (warn at 500MB)
// ---------------------------------------------------------------------------

const STORAGE_WARNING_BYTES = 500 * 1024 * 1024;

export async function checkStorageBudget(): Promise<{
  used: number;
  quota: number;
  warningReached: boolean;
}> {
  if (navigator.storage === undefined || navigator.storage.estimate === undefined) {
    return { used: 0, quota: Infinity, warningReached: false };
  }
  const est = await navigator.storage.estimate();
  const used = est.usage ?? 0;
  const quota = est.quota ?? Infinity;
  return {
    used,
    quota,
    warningReached: used >= STORAGE_WARNING_BYTES,
  };
}
