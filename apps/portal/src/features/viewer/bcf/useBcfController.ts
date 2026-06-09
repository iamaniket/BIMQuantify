'use client';

import { useCallback, useMemo } from 'react';

import type { DocumentViewerHandle, MarkupDraft, ViewerHandle } from '@bimstitch/viewer';

import type { BcfViewpointCreateInput, BcfViewpointRead } from '@/lib/api/schemas/bcf';

import { buildBcfViewpointPayload } from './buildBcfViewpointPayload';
import { useBcfCapture } from './useBcfCapture';

export type BcfCaptureResult = {
  viewpoint: BcfViewpointCreateInput;
  snapshotDataUrl: string | null;
};

/**
 * Abstraction that lets the BCF panel drive either the 3D viewer or the 2D
 * document viewer. `capture()` builds a viewpoint + snapshot for a new topic;
 * `applyViewpoint()` restores a saved topic's view.
 */
export type BcfController = {
  /** Whether a viewpoint can be captured (a viewer handle is attached). */
  canCapture: boolean;
  /** '3d' captures the camera; '2d' captures the current PDF markup draft. */
  captureMode: '3d' | '2d';
  capture: () => Promise<BcfCaptureResult | null>;
  applyViewpoint: (vp: BcfViewpointRead) => Promise<void>;
};

/** Controller backed by the 3D IFC viewer (unchanged behaviour). */
export function use3dBcfController(handle: ViewerHandle | null): BcfController {
  const { capture } = useBcfCapture(handle);
  return useMemo<BcfController>(
    () => ({
      canCapture: handle !== null,
      captureMode: '3d',
      capture,
      applyViewpoint: async (vp) => {
        if (handle === null) return;
        await handle.commands.execute('bcf.applyViewpoint', buildBcfViewpointPayload(vp));
      },
    }),
    [handle, capture],
  );
}

type View2DState = { page: number; center_x: number; center_y: number; zoom: number };

/**
 * Controller backed by the 2D document viewer. Captures the current markup
 * draft (drawn shape) + a composited snapshot into a 2D BCF viewpoint, and
 * restores a topic by jumping to its page.
 */
export function use2dBcfController(
  documentHandle: DocumentViewerHandle | null,
  opts: { fileId: string; onRestorePage: (page: number) => void },
): BcfController {
  const { fileId, onRestorePage } = opts;

  const capture = useCallback(async (): Promise<BcfCaptureResult | null> => {
    if (documentHandle === null) return null;
    const draft = await documentHandle.commands.execute<MarkupDraft | null>('markup.getDraft');
    if (draft === null) return null;
    const view = await documentHandle.commands.execute<View2DState>('markup.getViewState');
    const snapshotDataUrl =
      (await documentHandle.commands.execute<string | null>('markup.captureSnapshot', {
        maxWidth: 480,
      })) ?? null;

    const viewpoint: BcfViewpointCreateInput = {
      guid: crypto.randomUUID(),
      index_in_topic: 0,
      camera_type: 'orthographic',
      camera_view_point: { x: 0, y: 0, z: 0 },
      camera_direction: { x: 0, y: 0, z: -1 },
      camera_up_vector: { x: 0, y: 1, z: 0 },
      field_of_view: null,
      field_of_height: null,
      clipping_planes: [],
      measurements: [],
      is_2d: true,
      view_state_2d: {
        center_x: view.center_x,
        center_y: view.center_y,
        zoom: view.zoom,
        visible_layers: [],
        file_type: 'pdf',
        page: draft.page,
        annotations: [
          {
            id: crypto.randomUUID(),
            tool: draft.tool,
            points: draft.points,
            ...(draft.text !== undefined ? { text: draft.text } : {}),
            color: draft.color,
            strokeWidth: draft.strokeWidth,
          },
        ],
      },
      linked_file_id: fileId,
    };
    return { viewpoint, snapshotDataUrl };
  }, [documentHandle, fileId]);

  return useMemo<BcfController>(
    () => ({
      canCapture: documentHandle !== null,
      captureMode: '2d',
      capture,
      applyViewpoint: async (vp) => {
        const vs = vp.view_state_2d as { page?: number } | null;
        if (vs && typeof vs.page === 'number') onRestorePage(vs.page);
      },
    }),
    [documentHandle, capture, onRestorePage],
  );
}
