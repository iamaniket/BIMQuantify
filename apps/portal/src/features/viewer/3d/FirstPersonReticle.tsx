'use client';

import { Crosshair } from '@bimdossier/ui/icons';
import { useEffect, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  /** Gate: render only in 3D-bearing modes (the page passes `viewMode !== '2d'`). */
  active: boolean;
};

/**
 * Center reticle shown only while the viewer is in first-person navigation. It
 * marks the look/forward direction (and the teleport target) so walking and
 * aiming feel precise, matching the walk-mode crosshair in Navisworks/Revizto/BIMx.
 *
 * Pane-scoped (mounted inside the 3D-pane wrapper, so it stays centered on the
 * pane in split) and `pointer-events-none` so it never intercepts navigation.
 * Colours are intentionally white-over-dark rather than design tokens: the reticle
 * must contrast against arbitrary WebGL content, not the app theme, so a stacked
 * dark+light crosshair gives a visible outline on both pale and dark models.
 */
export function FirstPersonReticle({ handle, viewerReady, active }: Props): JSX.Element | null {
  const [firstPerson, setFirstPerson] = useState(false);

  useEffect(() => {
    if (!handle || !viewerReady) {
      setFirstPerson(false);
      return undefined;
    }
    let cancelled = false;
    // Seed the current mode — `navmode:change` may have fired before this mounted.
    void handle.commands
      .execute<{ navMode: 'orbit' | 'firstPerson' }>('tool.get')
      .then((s) => {
        if (!cancelled) setFirstPerson(s?.navMode === 'firstPerson');
      })
      .catch(() => undefined);
    const off = handle.events.on('navmode:change', ({ mode }) => {
      setFirstPerson(mode === 'firstPerson');
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [handle, viewerReady]);

  if (!active || !firstPerson) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="relative h-7 w-7">
        <Crosshair weight="bold" className="absolute inset-0 h-7 w-7 text-black/50" />
        <Crosshair weight="regular" className="absolute inset-0 h-7 w-7 text-white/90" />
      </div>
    </div>
  );
}
