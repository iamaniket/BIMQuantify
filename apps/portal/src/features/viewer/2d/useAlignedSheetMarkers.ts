'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  DocumentViewerHandle,
  EntityMarker2DData,
  ViewerHandle,
} from '@bimdossier/viewer';

import { useFileFindings } from '@/features/findings/useFindings';
import { useModelFindingMarkers } from '@/features/viewer/shared/useEntityMarkers';
import type { Finding } from '@/lib/api/schemas';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import { elevationBand } from './elevationBand';
import type { SheetTransform } from './sheetTransform';

interface AlignedSheetMarkersOptions {
  docHandle: DocumentViewerHandle | null;
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
  projectId: string;
  /** The 3D model's file id — its IFC-anchored findings are projected onto the sheet. */
  fileId: string | null;
  /** Floor-plan levels (for the active-storey elevation band). */
  levels: { elevation: number }[];
  activeLevel: number;
  /**
   * The active sheet transform. Drives a marker recompute when it changes — once
   * the minimap holds this transform, `minimap.projectPoints` returns PDF page
   * coords directly.
   */
  sheetTransform: SheetTransform | null;
  enabled: boolean;
  onFindingClick: (finding: Finding) => void;
}

type Projected = { x: number; y: number; elevation: number } | null;

/**
 * The aligned-PDF counterpart to {@link useFloorPlanFindingMarkers}: projects the
 * 3D model's IFC-anchored findings onto a calibrated PDF sheet and feeds them to
 * the DocumentViewer's `entity-marker-2d` plugin.
 *
 * With the sheet transform active on the minimap, `minimap.projectPoints`
 * returns *raw normalized PDF page coords* (top-left, Y-down) — the SAME
 * convention the entity-marker-2d plugin and the calibration picks use. So
 * markers sync directly with **no union-bbox normalization and no Y-flip** (that
 * flip in the generated-plan hook is a union-box artifact, not a convention
 * flip). Elevation passes through the transform untouched, so the active-storey
 * band filter is unchanged.
 */
export function useAlignedSheetMarkers(opts: AlignedSheetMarkersOptions): void {
  const {
    docHandle,
    viewerHandle,
    viewerReady,
    projectId,
    fileId,
    levels,
    activeLevel,
    sheetTransform,
    enabled,
  } = opts;

  const scopedFileId = enabled ? fileId : null;
  const markers3D = useModelFindingMarkers(projectId, scopedFileId);

  // Recompute when the minimap (re)calibrates — `calibrate` is what installs the
  // sheet transform, after which `projectPoints` returns PDF page coords.
  const [calibratedNonce, setCalibratedNonce] = useState(0);
  useEffect(() => {
    if (!viewerHandle || !viewerReady) return undefined;
    return viewerHandle.events.on('minimap:calibrated', () => {
      setCalibratedNonce((n) => n + 1);
    });
  }, [viewerHandle, viewerReady]);

  useEffect(() => {
    if (!docHandle || !viewerHandle || !enabled || levels.length === 0) return undefined;
    let cancelled = false;
    void (async () => {
      const positions = markers3D.map((m) => m.position);
      const projected = await viewerHandle.commands
        .execute<Projected[]>('minimap.projectPoints', positions)
        .catch(() => [] as Projected[]);
      if (cancelled) return;

      const activeElevation = levels[activeLevel]?.elevation ?? 0;
      const band = elevationBand(levels, activeLevel);

      const markers2D: EntityMarker2DData[] = [];
      markers3D.forEach((m, i) => {
        const p = projected[i];
        if (!p) return;
        if (Math.abs(p.elevation - activeElevation) > band) return;
        // Already PDF page coords (top-left, Y-down) — sync raw, no flip.
        markers2D.push({
          id: m.id,
          type: 'finding',
          x: p.x,
          y: p.y,
          label: m.label,
          entityId: m.entityId,
          ...(m.status ? { status: m.status } : {}),
          ...(m.draft ? { draft: true } : {}),
        });
      });

      docHandle.commands.execute('entity-marker-2d.sync', markers2D).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [docHandle, viewerHandle, enabled, levels, activeLevel, markers3D, sheetTransform, calibratedNonce]);

  // Resolve marker clicks back to findings.
  const findings = flattenPages(useFileFindings(projectId, scopedFileId).data);
  const findingMap = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const cbRef = useRef(opts.onFindingClick);
  cbRef.current = opts.onFindingClick;

  useEffect(() => {
    if (!docHandle || !enabled) return undefined;
    return docHandle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findingMap.get(ev.entityId);
        if (f) cbRef.current(f);
      }
    });
  }, [docHandle, enabled, findingMap]);
}
