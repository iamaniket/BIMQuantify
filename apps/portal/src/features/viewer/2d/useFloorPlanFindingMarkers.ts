'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  unionBbox,
  type DecodedFloorPlans,
  type DocumentViewerHandle,
  type EntityMarker2DData,
  type ViewerHandle,
} from '@bimdossier/viewer';

import { useFileFindings } from '@/features/findings/useFindings';
import { useModelFindingMarkers } from '@/features/viewer/shared/useEntityMarkers';
import type { Finding } from '@/lib/api/schemas';
import { useFlattenedPages } from '@/lib/query/useAuthInfiniteQuery';

import { elevationBand } from './elevationBand';

interface FloorPlanFindingMarkersOptions {
  fpHandle: DocumentViewerHandle | null;
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
  projectId: string;
  fileId: string | null;
  data: DecodedFloorPlans | null;
  /** Active level index into `data.levels`. */
  activeLevel: number;
  enabled: boolean;
  onFindingClick: (finding: Finding) => void;
}

type Projected = { x: number; y: number; elevation: number } | null;

/**
 * Project IFC-anchored findings onto the 2D plan and feed them to the floor
 * plan's `entity-marker-2d` plugin. Findings carry world (3D) anchors; we
 * project them through the minimap calibration (`minimap.projectPoints`),
 * keep only those near the active level's elevation, normalize against the
 * union page box, and sync. Clicks resolve back to findings.
 */
export function useFloorPlanFindingMarkers(opts: FloorPlanFindingMarkersOptions): void {
  const { fpHandle, viewerHandle, viewerReady, projectId, fileId, data, activeLevel, enabled } = opts;
  const scopedFileId = enabled ? fileId : null;

  const markers3D = useModelFindingMarkers(projectId, scopedFileId);

  const union = useMemo(() => (data ? unionBbox(data.levels) : null), [data]);

  // Recompute when calibration becomes available.
  const [calibratedNonce, setCalibratedNonce] = useState(0);
  useEffect(() => {
    if (!viewerHandle || !viewerReady) return undefined;
    const off = viewerHandle.events.on('minimap:calibrated', () => {
      setCalibratedNonce((n) => n + 1);
    });
    return off;
  }, [viewerHandle, viewerReady]);

  const levels = data?.levels;

  useEffect(() => {
    if (!fpHandle || !viewerHandle || !enabled || !union || !levels) return undefined;
    let cancelled = false;
    void (async () => {
      const positions = markers3D.map((m) => m.position);
      const projected = await viewerHandle.commands
        .execute<Projected[]>('minimap.projectPoints', positions)
        .catch(() => [] as Projected[]);
      if (cancelled) return;

      const activeElevation = levels[activeLevel]?.elevation ?? 0;
      const band = elevationBand(levels, activeLevel);
      const planW = union.maxX - union.minX || 1;
      const planH = union.maxY - union.minY || 1;

      const markers2D: EntityMarker2DData[] = [];
      markers3D.forEach((m, i) => {
        const p = projected[i];
        if (!p) return;
        if (Math.abs(p.elevation - activeElevation) > band) return;
        // Normalized 0..1, top-left, Y-down — relative to the union page box.
        const nx = (p.x - union.minX) / planW;
        const ny = 1 - (p.y - union.minY) / planH;
        markers2D.push({
          id: m.id,
          type: 'finding',
          x: nx,
          y: ny,
          label: m.label,
          entityId: m.entityId,
          ...(m.status ? { status: m.status } : {}),
          ...(m.draft ? { draft: true } : {}),
        });
      });

      fpHandle.commands.execute('entity-marker-2d.sync', markers2D).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [fpHandle, viewerHandle, enabled, union, levels, activeLevel, markers3D, calibratedNonce]);

  // Resolve marker clicks back to findings.
  const findings = useFlattenedPages(useFileFindings(projectId, scopedFileId).data);
  const findingMap = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const cbRef = useRef(opts.onFindingClick);
  cbRef.current = opts.onFindingClick;

  useEffect(() => {
    if (!fpHandle || !enabled) return undefined;
    const off = fpHandle.events.on('entity-marker:click', (ev) => {
      if (ev.type === 'finding') {
        const f = findingMap.get(ev.entityId);
        if (f) cbRef.current(f);
      }
    });
    return off;
  }, [fpHandle, enabled, findingMap]);
}
