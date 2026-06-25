'use client';

import { useEffect } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

interface CalibrationEntryCameraOptions {
  viewerHandle: ViewerHandle | null;
  viewerReady: boolean;
}

type CameraProjection = 'Orthographic' | 'Perspective';
type NavMode = 'orbit' | 'firstPerson';

/**
 * On entering calibration (PDF↔3D alignment) mode, orient the 3D pane to a
 * top-down orthographic view so it visually matches the inherently top-down,
 * flat 2D PDF plan beside it — making it easy to eyeball the same two points on
 * both surfaces. The alignment math is unaffected: model picks are projected
 * through `minimap.projectPoint` as exact 3D world points, not screen coords.
 *
 * Mirrors {@link import('./useSplitEntryCamera').useSplitEntryCamera}: a mode
 * entry mutates the camera once, and leaving restores the prior projection +
 * navigation mode so 3D/Split stay perspective-orbit as before. This hook is
 * called from `CalibrationPane`, which mounts only while in calibration mode —
 * so mount = enter, unmount = exit.
 *
 * Orthographic + top framing require Orbit nav, so we force it first (the user
 * may have arrived from Split's first-person). Order matters: switch projection
 * (and let the new command re-bind fragments) BEFORE `camera.view.top`, so its
 * framing fits the orthographic frustum.
 */
export function useCalibrationEntryCamera(opts: CalibrationEntryCameraOptions): void {
  const { viewerHandle, viewerReady } = opts;

  useEffect(() => {
    if (!viewerHandle || !viewerReady) return undefined;

    let cancelled = false;
    // Captured prior state, restored on teardown. Defaults are the app's normal
    // mode, used if the capture read is interrupted or fails.
    const prior: { projection: CameraProjection; navMode: NavMode } = {
      projection: 'Perspective',
      navMode: 'orbit',
    };

    const run = async (): Promise<void> => {
      const projection = await viewerHandle.commands
        .execute<CameraProjection>('camera.getProjection')
        .catch(() => 'Perspective' as CameraProjection);
      const tool = await viewerHandle.commands
        .execute<{ navMode: NavMode }>('tool.get')
        .catch(() => ({ navMode: 'orbit' as NavMode }));
      if (cancelled) return;
      prior.projection = projection;
      prior.navMode = tool?.navMode ?? 'orbit';

      await viewerHandle.commands.execute('tool.set', { navMode: 'orbit' }).catch(() => undefined);
      if (cancelled) return;
      await viewerHandle.commands
        .execute('camera.setProjection', { mode: 'Orthographic' })
        .catch(() => undefined);
      if (cancelled) return;
      await viewerHandle.commands.execute('camera.view.top').catch(() => undefined);
    };

    void run();

    return () => {
      cancelled = true;
      void viewerHandle.commands
        .execute('camera.setProjection', { mode: prior.projection })
        .catch(() => undefined);
      void viewerHandle.commands
        .execute('tool.set', { navMode: prior.navMode })
        .catch(() => undefined);
    };
  }, [viewerHandle, viewerReady]);
}
