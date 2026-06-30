'use client';

import { useEffect, useRef } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

import type { FloorPlanDisplayLevel } from './useFloorPlanData';

type SplitEntryCameraOptions = {
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

/**
 * On entering Split view:
 *   1. Read the live 3D camera, recover its IFC elevation, and open the floor-plan
 *      pane on the level whose elevation is nearest the camera height (rather than
 *      always level 0). This only changes the 2D plan's active floor.
 *   2. Switch the 3D pane to first-person navigation.
 *
 * A mode switch must NOT move the 3D camera — only toggle the nav mode. Entering
 * first-person is position-preserving (camera-fly re-asserts the current pose on
 * enter), so the camera stays exactly where it was; we no longer snap it onto the
 * level. Leaving Split restores orbit (handled in the toolbar) — also jump-free.
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

      // Open the plan on the floor the user was looking at — this drives only the
      // 2D plan's active level, NOT the 3D camera.
      setActiveLevelRef.current(best);

      // Toggle the 3D pane to first-person. Position-preserving (camera-fly
      // re-asserts the current pose on enter), so the camera does not move — a
      // mode switch only changes the nav mode.
      await viewerHandle.commands
        .execute('tool.set', { navMode: 'firstPerson' })
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
