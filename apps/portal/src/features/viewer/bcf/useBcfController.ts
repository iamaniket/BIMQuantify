'use client';

import { useCallback, useMemo } from 'react';

import type { DocumentViewerHandle, MarkupDraft, MarkupTool, ViewerHandle } from '@bimdossier/viewer';

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
  /** (2D only) Activate a markup tool so the user can draw an annotation. */
  activateMarkup: ((tool?: MarkupTool) => void) | undefined;
  /** (2D only) Clear the current draft annotation. */
  clearDraft: (() => void) | undefined;
  /** (2D only) Subscribe to draft-state changes. Returns an unsubscribe fn. */
  onDraftChange: ((cb: (hasDraft: boolean) => void) => () => void) | undefined;
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
      activateMarkup: undefined,
      clearDraft: undefined,
      onDraftChange: undefined,
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

    const view = await documentHandle.commands.execute<View2DState>('markup.getViewState');
    const snapshotDataUrl =
      (await documentHandle.commands.execute<string | null>('markup.captureSnapshot', {
        maxWidth: 480,
      })) ?? null;

    const draft = await documentHandle.commands.execute<MarkupDraft | null>('markup.getDraft');

    const annotations = draft !== null
      ? [
          {
            id: crypto.randomUUID(),
            tool: draft.tool,
            points: draft.points,
            ...(draft.text !== undefined ? { text: draft.text } : {}),
            color: draft.color,
            strokeWidth: draft.strokeWidth,
          },
        ]
      : [];

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
        page: draft !== null ? draft.page : view.page,
        annotations,
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
      applyViewpoint: (vp) => {
        const vs = vp.view_state_2d as
          | { page?: number; center_x?: number; center_y?: number; zoom?: number }
          | null;
        if (vs === null) return Promise.resolve();
        // Sync the React page state (drives the page indicator + controlled prop).
        if (typeof vs.page === 'number') onRestorePage(vs.page);
        // Pan + zoom the document to the stored framing. The command jumps to
        // the page itself (waiting for its render) before positioning.
        if (
          documentHandle !== null &&
          typeof vs.center_x === 'number' &&
          typeof vs.center_y === 'number'
        ) {
          documentHandle.commands
            .execute('camera.restore2DView', {
              page: typeof vs.page === 'number' ? vs.page : undefined,
              center_x: vs.center_x,
              center_y: vs.center_y,
              zoom: typeof vs.zoom === 'number' ? vs.zoom : 1,
            })
            .catch(() => undefined);
        }
        return Promise.resolve();
      },
      activateMarkup: (tool: MarkupTool = 'rect') => {
        if (documentHandle === null) return;
        void documentHandle.commands.execute('measure.deactivate').catch(() => undefined);
        void documentHandle.commands.execute('markup.setStyle', { color: '#ef4444' }).catch(() => undefined);
        void documentHandle.commands.execute('markup.activate', { mode: tool }).catch(() => undefined);
      },
      clearDraft: () => {
        if (documentHandle === null) return;
        void documentHandle.commands.execute('markup.clearDraft');
      },
      onDraftChange: (cb: (hasDraft: boolean) => void) => {
         
        if (documentHandle === null) return () => {};
        documentHandle.commands.execute<MarkupDraft | null>('markup.getDraft')
          .then((d) => { cb(d !== null); })
          .catch(() => undefined);
        const offChange = documentHandle.events.on('markup:change', ({ hasDraft }) => {
          cb(hasDraft);
        });
        const offDraft = documentHandle.events.on('markup:draftComplete', () => {
          cb(true);
        });
        return () => { offChange(); offDraft(); };
      },
    }),
    [documentHandle, capture, onRestorePage],
  );
}
