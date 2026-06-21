'use client';

import { MapPin, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

import type { DocumentViewerHandle, ViewerHandle } from '@bimstitch/viewer';

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

export function FindingPinButton({
  fileType,
  currentAnchor,
  onAnchorChange,
  documentHandle,
  viewerHandle,
  linkModelId,
  linkFileId,
  resolvePickedGlobalId,
  disabled,
}: Props): JSX.Element | null {
  const tPin = useTranslations('findings.detail.pin');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);

  // A 3D viewer handle is enough to pin to the model — a null `fileType`
  // (the inspector's no-selection "project mode") still means IFC. Only an
  // explicit `pdf` file type routes to the 2D drawing-pin flow.
  const hasPdf = fileType === 'pdf' && documentHandle != null;
  const hasIfc = fileType !== 'pdf' && viewerHandle != null;
  const active = hasPdf || hasIfc;

  const isPinned = currentAnchor != null && currentAnchor.anchor_x != null;

  const startPlacement = useCallback(() => {
    if (placing || !active) return;
    setPlacing(true);
    placingRef.current = true;

    if (hasPdf && documentHandle) {
      documentHandle.commands.execute('entity-marker-2d.beginPlace', { type: 'finding' });
    } else if (hasIfc && viewerHandle) {
      viewerHandle.commands.execute('placement.enter', { oneShot: true });
    }
  }, [placing, active, hasPdf, hasIfc, documentHandle, viewerHandle]);

  const cancelPlacement = useCallback(() => {
    if (!placingRef.current) return;
    setPlacing(false);
    placingRef.current = false;

    if (hasPdf && documentHandle) {
      documentHandle.commands.execute('entity-marker-2d.endPlace');
    } else if (hasIfc && viewerHandle) {
      viewerHandle.commands.execute('placement.exit');
    }
  }, [hasPdf, hasIfc, documentHandle, viewerHandle]);

  useEffect(() => {
    if (!hasPdf || !documentHandle) return;
    const off = documentHandle.events.on(
      'entity-marker:place',
      (evt: { x: number; y: number; page: number }) => {
        if (!placingRef.current) return;
        setPlacing(false);
        placingRef.current = false;
        const a = anchorPdf(evt.page, evt.x, evt.y);
        onAnchorChange(a);
      },
    );
    return off;
  }, [hasPdf, documentHandle, onAnchorChange]);

  useEffect(() => {
    if (!hasIfc || !viewerHandle) return;
    const off = viewerHandle.events.on('point:picked', (evt) => {
      if (!placingRef.current) return;
      setPlacing(false);
      placingRef.current = false;
      // Stamp the active model/file so the pin renders as a marker, and
      // auto-link the picked element (active model only) when one was hit.
      const next: AnchorState = { ...anchor3d(evt.point) };
      if (linkFileId != null) {
        next.linked_file_id = linkFileId;
        if (linkModelId != null) next.linked_model_id = linkModelId;
      }
      const gid = resolvePickedGlobalId?.(evt.item) ?? null;
      if (gid != null) next.linkedElementGlobalId = gid;
      onAnchorChange(next);
    });
    return off;
  }, [hasIfc, viewerHandle, onAnchorChange, linkFileId, linkModelId, resolvePickedGlobalId]);

  useEffect(() => {
    if (!hasIfc || !viewerHandle) return;
    const off = viewerHandle.events.on(
      'placement:change',
      (evt: { active: boolean }) => {
        if (!evt.active && placingRef.current) {
          setPlacing(false);
          placingRef.current = false;
        }
      },
    );
    return off;
  }, [hasIfc, viewerHandle]);

  useEffect(() => {
    return () => {
      if (placingRef.current) {
        if (hasPdf && documentHandle) {
          documentHandle.commands.execute('entity-marker-2d.endPlace');
        } else if (hasIfc && viewerHandle) {
          viewerHandle.commands.execute('placement.exit');
        }
      }
    };
  }, [hasPdf, hasIfc, documentHandle, viewerHandle]);

  if (!active) return null;

  const label = fileType === 'pdf' ? tPin('pinToDrawing') : tPin('pinToModel');
  const hint = fileType === 'pdf' ? tPin('placementHintPdf') : tPin('placementHintIfc');

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
