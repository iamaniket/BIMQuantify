'use client';

import { useCallback } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { BcfViewpointCreateInput } from '@/lib/api/schemas/bcf';

type BcfCaptureResult = {
  viewpoint: BcfViewpointCreateInput;
  snapshotDataUrl: string | null;
};

const THUMBNAIL_MAX_WIDTH = 480;

/**
 * Downsamples a data URL to a thumbnail whose width is at most `maxWidth`.
 * Height is derived from the image's actual aspect ratio so nothing is distorted.
 */
async function resizeToThumbnail(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { resolve(dataUrl); }; // fallback: keep original
    img.src = dataUrl;
  });
}

/**
 * Hook that captures the current 3D viewer state as a BCF viewpoint + snapshot.
 * Uses the viewer's `bcf.captureViewpoint` and `bcf.captureSnapshot` commands.
 * Snapshot is captured at native canvas resolution then downsampled to a
 * thumbnail (max 480 px wide) so the aspect ratio is always correct.
 */
export function useBcfCapture(handle: ViewerHandle | null): {
  capture: () => Promise<BcfCaptureResult | null>;
} {
  const capture = useCallback(async (): Promise<BcfCaptureResult | null> => {
    if (handle === null) return null;

    const vpData = await handle.commands.execute('bcf.captureViewpoint');
    if (vpData === undefined) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vp = vpData as any;

    // Capture at native canvas size (no width/height) so the camera aspect
    // ratio is correct, then downsample to a small thumbnail.
    const nativeDataUrl =
      ((await handle.commands.execute('bcf.captureSnapshot')) as string | null) ?? null;

    const snapshotDataUrl =
      nativeDataUrl !== null
        ? await resizeToThumbnail(nativeDataUrl, THUMBNAIL_MAX_WIDTH)
        : null;

    const guid = crypto.randomUUID();
    const cam = vp.camera ?? {};

    const viewpoint: BcfViewpointCreateInput = {
      guid,
      index_in_topic: 0,
      camera_type: cam.type ?? 'perspective',
      camera_view_point: cam.viewPoint ?? { x: 0, y: 0, z: 0 },
      camera_direction: cam.direction ?? { x: 0, y: 0, z: -1 },
      camera_up_vector: cam.upVector ?? { x: 0, y: 1, z: 0 },
      field_of_view: cam.fieldOfView ?? null,
      field_of_height: cam.fieldOfHeight ?? null,
      components: vp.components
        ? {
            default_visibility:
              vp.components.visibility?.defaultVisibility ?? true,
            visibility_exceptions:
              vp.components.visibility?.exceptions ?? [],
            selection: vp.components.selection ?? [],
          }
        : undefined,
      clipping_planes: (vp.clippingPlanes ?? []).map(
        (cp: { location: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }) => ({
          location: cp.location,
          direction: cp.direction,
        }),
      ),
      is_2d: false,
    };

    return { viewpoint, snapshotDataUrl };
  }, [handle]);

  return { capture };
}
