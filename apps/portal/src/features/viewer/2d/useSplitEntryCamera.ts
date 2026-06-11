'use client';

import { useEffect, useRef } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { FloorPlanDisplayLevel } from './useFloorPlanData';

interface SplitEntryCameraOptions {
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
  /** True only in Split mode — first-person + camera snap need the 3D pane visible. */
  enabled: boolean;
  levels: FloorPlanDisplayLevel[];
  setActiveLevel: (i: number) => void;
}

/** A camera pose (world coords) from `camera.getPose`. */
type CameraPose = { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null;
/** A plan projection (+recovered IFC elevation) from `minimap.projectPoint`. */
type Projected = { x: number; y: number; elevation: number } | null;

/** Horizontal heading is degenerate below this plan distance → nudge the look point. */
const MIN_HEADING_DISTANCE = 1e-3;

/**
 * On entering Split view, make the floor-plan pane "step into" the building at the
 * level the user was already looking at, rather than always opening on level 0:
 *   1. Read the live 3D camera, recover its IFC elevation, and select the level
 *      whose elevation is nearest the camera height.
 *   2. Snap the camera onto that level (floor + eye height), preserving the current
 *      horizontal position + heading.
 *   3. Enter first-person navigation so the user can immediately walk the level.
 *
 * Runs once per Split entry (guarded by `didInit`); a manual level change afterward
 * is therefore never overridden. Reuses the minimap plugin's calibration (the 3D
 * viewer stays mounted in all modes) — no new viewer commands.
 */
export function useSplitEntryCamera(opts: SplitEntryCameraOptions): void {
  const { viewerHandle, viewerReady, enabled, levels, setActiveLevel } = opts;

  const didInit = useRef(false);
  // Keep latest values readable inside the (intentionally stable) async runner.
  const levelsRef = useRef(levels);
  const setActiveLevelRef = useRef(setActiveLevel);
  levelsRef.current = levels;
  setActiveLevelRef.current = setActiveLevel;

  // Recompute on a fresh Split entry: clear the guard whenever we leave Split.
  useEffect(() => {
    if (!enabled) didInit.current = false;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !viewerHandle || !viewerReady || levels.length === 0) return undefined;
    if (didInit.current) return undefined;

    let cancelled = false;

    const run = async (): Promise<void> => {
      if (cancelled || didInit.current) return;

      const pose = await viewerHandle.commands.execute<CameraPose>('camera.getPose').catch(() => null);
      if (cancelled || !pose) return;

      const here = await viewerHandle.commands
        .execute<Projected>('minimap.projectPoint', pose.position)
        .catch(() => null);
      // Not calibrated yet → leave the guard unset; `minimap:calibrated` re-runs.
      if (cancelled || !here) return;

      const look = await viewerHandle.commands
        .execute<Projected>('minimap.projectPoint', pose.target)
        .catch(() => null);
      if (cancelled) return;

      const currentLevels = levelsRef.current;
      if (currentLevels.length === 0) return;

      // Nearest level by elevation.
      let best = 0;
      let bestDistance = Infinity;
      currentLevels.forEach((lv, i) => {
        const d = Math.abs(lv.elevation - here.elevation);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });

      didInit.current = true;

      const target = currentLevels[best];
      if (!target) return;

      setActiveLevelRef.current(best);

      // Preserve heading; guard against a straight-down orbit view where the
      // projected here↔look points coincide (no valid forward direction).
      let lookX = look?.x ?? here.x;
      let lookY = look?.y ?? here.y;
      if (Math.hypot(lookX - here.x, lookY - here.y) < MIN_HEADING_DISTANCE) {
        lookX = here.x;
        lookY = here.y + 1;
      }

      // Enter first-person BEFORE the snap so the mode switch doesn't disturb the
      // final pose.
      await viewerHandle.commands
        .execute('tool.set', { navMode: 'firstPerson' })
        .catch(() => undefined);
      if (cancelled) return;

      await viewerHandle.commands
        .execute('minimap.placeCamera', {
          planX: here.x,
          planY: here.y,
          lookX,
          lookY,
          elevation: target.elevation,
          animate: false,
        })
        .catch(() => undefined);
    };

    void run();
    const offCal = viewerHandle.events.on('minimap:calibrated', () => {
      void run();
    });
    return () => {
      cancelled = true;
      offCal();
    };
  }, [enabled, viewerHandle, viewerReady, levels]);
}
