'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { FloorPlanViewerHandle, ViewerHandle } from '@bimstitch/viewer';

import { buildStoreyMembership } from '@/features/viewer/3d/minimap/storeyMembership';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

import type { FloorPlanDisplayLevel } from './useFloorPlanData';

interface FloorPlanLinkOptions {
  fpHandle: FloorPlanViewerHandle | null;
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
  levels: FloorPlanDisplayLevel[];
  activeLevel: number;
  /** Isolate the active storey in 3D (Split/2D default). */
  isolate: boolean;
  metadata: ModelMetadata | undefined;
  /** IFC horizontal axis indices for the plan (for calibration in Split/2D). */
  planAxisX: number;
  planAxisY: number;
}

/** A world-space centroid command result. */
type Centroid = { x: number; y: number; z: number } | null;
/** A plan projection command result. */
type Projected = { x: number; y: number; elevation: number } | null;
/** A camera pose (world coords) from `camera.getPose`. */
type CameraPose = { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null;

/**
 * Wire the bidirectional 2D↔3D link, routed through the Phase-1 minimap plugin
 * (the 3D viewer stays mounted in all modes, so its calibration persists):
 *   - 2D→3D: a plan click flies the 3D camera (`minimap.navigateTo`) and, when
 *     it lands near a room, selects that IfcSpace (`minimap.selectSpace`).
 *   - 3D→2D: a 3D selection projects its centroid onto the plan
 *     (`minimap.projectPoint`) and pans + pulses the floor-plan pane.
 *   - level→storey: the active level isolates its storey in 3D
 *     (`minimap.isolateItems`), reusing the metadata-derived membership.
 */
export function useFloorPlanLink(opts: FloorPlanLinkOptions): void {
  const { fpHandle, viewerHandle, viewerReady, levels, activeLevel, isolate, metadata, planAxisX, planAxisY } = opts;

  const storeyMembership = useMemo(() => buildStoreyMembership(metadata), [metadata]);

  // Ensure the minimap is calibrated in Split/2D too — the overlay MinimapView
  // (which calibrates in 3D mode) is unmounted here, and its calibration may not
  // have completed before this pane mounted. Idempotent; safe to call again.
  const ifcBbox = metadata?.bbox;
  useEffect(() => {
    if (!viewerHandle || !viewerReady || !ifcBbox) return;
    void viewerHandle.commands
      .execute('minimap.calibrate', { ifcBbox, planAxisX, planAxisY })
      .catch(() => undefined);
  }, [viewerHandle, viewerReady, ifcBbox, planAxisX, planAxisY]);

  // Suppress the 3D→2D bounce caused by our own programmatic selection.
  const lastSelectedSpaceRef = useRef<number | null>(null);
  // Keep the active level/levels readable inside stable event handlers.
  const activeLevelRef = useRef(activeLevel);
  const levelsRef = useRef(levels);
  activeLevelRef.current = activeLevel;
  levelsRef.current = levels;

  // 2D→3D: plan click → fly + (optional) select room.
  useEffect(() => {
    if (!fpHandle || !viewerHandle) return undefined;
    const off = fpHandle.events.on('floorplan:pick', (ev) => {
      const lvl = levelsRef.current[activeLevelRef.current];
      const elevation = lvl?.elevation ?? 0;
      void viewerHandle.commands
        .execute('minimap.navigateTo', { planX: ev.planX, planY: ev.planY, elevation })
        .catch(() => undefined);
      if (ev.spaceId != null) {
        lastSelectedSpaceRef.current = ev.spaceId;
        void viewerHandle.commands
          .execute('minimap.selectSpace', { spaceId: ev.spaceId })
          .catch(() => undefined);
      }
    });
    return off;
  }, [fpHandle, viewerHandle]);

  // 3D→2D: selection → project centroid → pan + pulse the plan.
  useEffect(() => {
    if (!fpHandle || !viewerHandle || !viewerReady) return undefined;
    const off = viewerHandle.events.on('selection:change', (ev) => {
      void (async () => {
        const selected = ev.selected;
        if (!selected || selected.length === 0) {
          lastSelectedSpaceRef.current = null;
          return;
        }
        // Skip the echo from our own 2D→3D selection.
        const sole = selected.length === 1 ? selected[0] : null;
        if (sole && sole.localId === lastSelectedSpaceRef.current) {
          lastSelectedSpaceRef.current = null;
          return;
        }
        const centroid = await viewerHandle.commands
          .execute<Centroid>('camera.getSelectionCentroid')
          .catch(() => null);
        if (!centroid) return;
        const proj = await viewerHandle.commands
          .execute<Projected>('minimap.projectPoint', centroid)
          .catch(() => null);
        if (!proj) return;
        fpHandle.focusPlanPoint(proj.x, proj.y);
        fpHandle.pulseAt(proj.x, proj.y);
      })();
    });
    return off;
  }, [fpHandle, viewerHandle, viewerReady]);

  // "You are here": mirror the 3D camera pose onto the plan. The minimap plugin
  // emits plan-projected poses on every camera move; we also seed once on mount
  // (the camera may be still when entering Split/2D).
  useEffect(() => {
    if (!fpHandle || !viewerHandle || !viewerReady) return undefined;
    // Seed the marker from the current camera pose. Calibration may not be ready
    // when the pane first mounts (it's async), so this also runs on
    // `minimap:calibrated`. Once calibrated, the static camera won't emit
    // `minimap:pose`, so the seed is the only path until the camera moves.
    const seed = async (): Promise<void> => {
      const pose = await viewerHandle.commands.execute<CameraPose>('camera.getPose').catch(() => null);
      if (!pose) return;
      const proj = await viewerHandle.commands
        .execute<Projected[]>('minimap.projectPoints', [pose.position, pose.target])
        .catch(() => [] as Projected[]);
      const here = proj[0];
      const look = proj[1];
      if (here && look) {
        fpHandle.setCameraPose({ hereX: here.x, hereY: here.y, lookX: look.x, lookY: look.y });
      }
    };
    const offPose = viewerHandle.events.on('minimap:pose', (pose) => {
      fpHandle.setCameraPose({ hereX: pose.here.x, hereY: pose.here.y, lookX: pose.look.x, lookY: pose.look.y });
    });
    const offCal = viewerHandle.events.on('minimap:calibrated', () => { void seed(); });
    void seed();
    return () => { offPose(); offCal(); };
  }, [fpHandle, viewerHandle, viewerReady]);

  // level→storey isolation. Restore the full model on unmount / mode exit.
  useEffect(() => {
    if (!viewerHandle || !viewerReady) return undefined;
    const lvl = levels[activeLevel];
    const localIds = lvl ? (storeyMembership.get(lvl.storeyExpressID) ?? []) : [];
    if (isolate && localIds.length > 0) {
      void viewerHandle.commands
        .execute('minimap.isolateItems', { localIds, label: lvl?.name ?? null })
        .catch(() => undefined);
    } else {
      void viewerHandle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    }
    return () => {
      void viewerHandle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    };
  }, [viewerHandle, viewerReady, levels, activeLevel, isolate, storeyMembership]);
}
