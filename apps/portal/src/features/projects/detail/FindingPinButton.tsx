'use client';

import { MapPin, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type {
  DocumentViewerHandle,
  FloorPlanViewerHandle,
  ViewerHandle,
} from '@bimstitch/viewer';

import type { ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import type { LinkedFileTypeValue } from '@/lib/api/schemas';
import { anchorPdf, anchor3d } from '@/lib/api/schemas/anchor';

export type AnchorState = {
  linked_file_type?: LinkedFileTypeValue | null | undefined;
  anchor_x?: number | null | undefined;
  anchor_y?: number | null | undefined;
  anchor_z?: number | null | undefined;
  anchor_page?: number | null | undefined;
  linked_model_id?: string | null | undefined;
  linked_file_id?: string | null | undefined;
  linkedElementGlobalId?: string | null | undefined;
};

/** The picked item shape from the viewer's `point:picked` event (`ItemId`). */
type PickedItem = { modelId: string; localId: number } | null;

/** Lift a normalized plan point (2D pick) to a 3D world anchor; null = off-plan. */
export type ConvertFloorPlanPoint = (
  norm: { x: number; y: number },
) => Promise<{ x: number; y: number; z: number } | null>;

type Props = {
  fileType: LinkedFileTypeValue | null;
  currentAnchor: AnchorState | null;
  onAnchorChange: (anchor: AnchorState | null) => void;
  documentHandle?: DocumentViewerHandle | null | undefined;
  viewerHandle?: ViewerHandle | null | undefined;
  /** Active model/file to stamp onto a 3D pin so it renders as a marker. */
  linkModelId?: string | null | undefined;
  linkFileId?: string | null | undefined;
  /** Resolve the picked element's GlobalId (active model only), else null. */
  resolvePickedGlobalId?: ((item: PickedItem) => string | null) | undefined;
  /** Current viewport layout — routes IFC picks to the floor-plan in 2D mode. */
  viewMode?: ViewMode | undefined;
  /** Floor-plan handle (2D plan surface) — used for the pick in `2d` view mode. */
  floorPlanHandle?: FloorPlanViewerHandle | null | undefined;
  /** Convert a normalized plan point (from the 2D pick) to a 3D world anchor. */
  convertFloorPlanPoint?: ConvertFloorPlanPoint | undefined;
  disabled?: boolean | undefined;
};

function formatCoord(n: number | undefined | null): string {
  if (n == null) return '–';
  return n.toFixed(2);
}

function anchorPreview(
  anchor: AnchorState,
  tPin: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (anchor.linked_file_type === 'pdf') {
    return anchor.anchor_page != null
      ? tPin('page', { n: anchor.anchor_page })
      : tPin('coords2d', { x: formatCoord(anchor.anchor_x), y: formatCoord(anchor.anchor_y) });
  }
  if (anchor.linked_file_type === 'ifc') {
    if (anchor.linkedElementGlobalId) {
      return tPin('element', { name: anchor.linkedElementGlobalId });
    }
    return tPin('coords3d', {
      x: formatCoord(anchor.anchor_x),
      y: formatCoord(anchor.anchor_y),
      z: formatCoord(anchor.anchor_z),
    });
  }
  return tPin('pinned');
}

/** Which viewer surface a pick is armed on. */
type PickSurface = 'pdf' | 'floorplan' | 'ifc' | null;

const BLOCKED_SELECTORS = ['[data-pick-block]'];

export function FindingPinButton({
  fileType,
  currentAnchor,
  onAnchorChange,
  documentHandle,
  viewerHandle,
  linkModelId,
  linkFileId,
  resolvePickedGlobalId,
  viewMode,
  floorPlanHandle,
  convertFloorPlanPoint,
  disabled,
}: Props): JSX.Element | null {
  const tPin = useTranslations('findings.detail.pin');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  // Cancel the in-flight guided pick (set at arm time, on the active surface).
  const armedCancelRef = useRef<(() => void) | null>(null);

  // A 3D viewer handle is enough to pin to the model — a null `fileType`
  // (the inspector's no-selection "project mode") still means IFC. Only an
  // explicit `pdf` file type routes to the 2D drawing-pin flow.
  const hasPdf = fileType === 'pdf' && documentHandle != null;
  const hasIfc = fileType !== 'pdf' && viewerHandle != null;
  // In 2D (floor-plan only) mode the 3D pane is hidden, so an IFC pin must be
  // picked on the plan surface; we then lift the plan point to a 3D world anchor.
  const canFloorPlan =
    hasIfc && viewMode === '2d' && floorPlanHandle != null && convertFloorPlanPoint != null;
  const surface: PickSurface = hasPdf ? 'pdf' : canFloorPlan ? 'floorplan' : hasIfc ? 'ifc' : null;
  const active = surface !== null;

  const isPinned = currentAnchor != null && currentAnchor.anchor_x != null;

  const stopPlacing = useCallback(() => {
    setPlacing(false);
    placingRef.current = false;
    armedCancelRef.current = null;
  }, []);

  const startPlacement = useCallback(() => {
    if (placing || surface === null) return;
    setPlacing(true);
    placingRef.current = true;

    if (surface === 'pdf' && documentHandle) {
      void documentHandle.commands.execute('interaction.request', {
        message: tPin('updateBanner'),
        hint: tPin('updateHintPdf'),
        placeType: 'finding',
        blockedSelectors: BLOCKED_SELECTORS,
      });
      armedCancelRef.current = () => {
        void documentHandle.commands.execute('interaction.cancel');
      };
    } else if (surface === 'floorplan' && floorPlanHandle) {
      void floorPlanHandle.commands.execute('interaction.request', {
        message: tPin('updateBanner'),
        hint: tPin('updateHint'),
        placeType: 'finding',
        blockedSelectors: BLOCKED_SELECTORS,
      });
      armedCancelRef.current = () => {
        void floorPlanHandle.commands.execute('interaction.cancel');
      };
    } else if (surface === 'ifc' && viewerHandle) {
      void viewerHandle.commands.execute('interaction.request', {
        message: tPin('updateBanner'),
        hint: tPin('updateHint'),
        // Keep the selected element so the inspector stays scoped to this finding
        // (clearing it would re-scope the panel and unmount this form mid-pick).
        keepSelection: true,
        blockedSelectors: BLOCKED_SELECTORS,
      });
      armedCancelRef.current = () => {
        void viewerHandle.commands.execute('interaction.cancel');
      };
    }
  }, [placing, surface, documentHandle, floorPlanHandle, viewerHandle, tPin]);

  const cancelPlacement = useCallback(() => {
    if (!placingRef.current) return;
    armedCancelRef.current?.();
    stopPlacing();
  }, [stopPlacing]);

  // 3D model pick → world point (+ auto-linked element when one was hit).
  useEffect(() => {
    if (!viewerHandle) return;
    const offResolved = viewerHandle.events.on('interaction:resolved', (evt) => {
      if (!placingRef.current || evt.kind !== 'point') return;
      stopPlacing();
      const next: AnchorState = { ...anchor3d(evt.point) };
      if (linkFileId != null) {
        next.linked_file_id = linkFileId;
        if (linkModelId != null) next.linked_model_id = linkModelId;
      }
      const gid = resolvePickedGlobalId?.(evt.item) ?? null;
      if (gid != null) next.linkedElementGlobalId = gid;
      onAnchorChange(next);
    });
    const offCancelled = viewerHandle.events.on('interaction:cancelled', () => {
      if (placingRef.current) stopPlacing();
    });
    return () => { offResolved(); offCancelled(); };
  }, [viewerHandle, onAnchorChange, linkFileId, linkModelId, resolvePickedGlobalId, stopPlacing]);

  // PDF drawing pick → normalized page point.
  useEffect(() => {
    if (!documentHandle) return;
    const offResolved = documentHandle.events.on('interaction:resolved', (evt) => {
      if (!placingRef.current || evt.kind !== 'page') return;
      stopPlacing();
      onAnchorChange(anchorPdf(evt.page, evt.x, evt.y));
    });
    const offCancelled = documentHandle.events.on('interaction:cancelled', () => {
      if (placingRef.current) stopPlacing();
    });
    return () => { offResolved(); offCancelled(); };
  }, [documentHandle, onAnchorChange, stopPlacing]);

  // Floor-plan pick → normalized plan point lifted to a 3D world anchor.
  useEffect(() => {
    if (!floorPlanHandle || !convertFloorPlanPoint) return;
    const offResolved = floorPlanHandle.events.on('interaction:resolved', (evt) => {
      if (!placingRef.current || evt.kind !== 'page') return;
      stopPlacing();
      void convertFloorPlanPoint({ x: evt.x, y: evt.y }).then((world) => {
        if (!world) return;
        const next: AnchorState = { ...anchor3d(world) };
        if (linkFileId != null) {
          next.linked_file_id = linkFileId;
          if (linkModelId != null) next.linked_model_id = linkModelId;
        }
        onAnchorChange(next);
      });
    });
    const offCancelled = floorPlanHandle.events.on('interaction:cancelled', () => {
      if (placingRef.current) stopPlacing();
    });
    return () => { offResolved(); offCancelled(); };
  }, [floorPlanHandle, convertFloorPlanPoint, onAnchorChange, linkFileId, linkModelId, stopPlacing]);

  // Cancel an in-flight pick when the surface changes (e.g. a view-mode switch)
  // so a stale overlay never lingers over a now-hidden pane.
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevViewModeRef.current !== viewMode) {
      prevViewModeRef.current = viewMode;
      if (placingRef.current) {
        armedCancelRef.current?.();
        stopPlacing();
      }
    }
  }, [viewMode, stopPlacing]);

  // Cancel a pick if the form unmounts mid-pick (no state update on unmount).
  useEffect(() => {
    return () => {
      if (placingRef.current) armedCancelRef.current?.();
    };
  }, []);

  if (!active) return null;

  const label = fileType === 'pdf' ? tPin('pinToDrawing') : tPin('pinToModel');
  const hint = surface === 'pdf' ? tPin('updateHintPdf') : tPin('updateHint');

  if (placing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-label2 font-medium text-primary">{tPin('placing')}</span>
          <Button type="button" variant="ghost" size="sm" onClick={cancelPlacement}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-caption text-foreground-tertiary">{hint}</p>
      </div>
    );
  }

  if (isPinned) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-low p-3">
        <MapPin className="h-4 w-4 shrink-0 text-primary" weight="fill" />
        <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">
          {anchorPreview(currentAnchor, tPin)}
        </span>
        {!disabled && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={startPlacement}>
              {tPin('updatePin')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { onAnchorChange(null); }}
            >
              {tPin('removePin')}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      disabled={disabled}
      onClick={startPlacement}
      className="self-start"
    >
      <MapPin className="mr-1.5 h-4 w-4" />
      {label}
    </Button>
  );
}
