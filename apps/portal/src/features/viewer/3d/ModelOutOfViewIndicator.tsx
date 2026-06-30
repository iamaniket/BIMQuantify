'use client';

import { AlertTriangle, Crosshair } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimdossier/viewer';

/** Payload of the viewer's `camera:framing` event. */
type FramingEvent = { inView: boolean; reason: string; coverage: number };

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  /**
   * Gate: render only in 3D-bearing modes and when nothing else owns the canvas
   * (loading overlay / alignment / edit mode). Driven by the page.
   */
  active: boolean;
};

/** Prefer the gentle recenter; fall back across viewer versions that lack it. */
function resolveRecenterCommand(handle: ViewerHandle): string {
  if (handle.commands.has('camera.recenter')) return 'camera.recenter';
  if (handle.commands.has('camera.zoomExtents')) return 'camera.zoomExtents';
  return 'camera.home';
}

/**
 * Non-blocking recovery pill over the 3D pane. Entering Split switches the camera
 * to first-person; panning can then slide the model out of the frustum and the 3D
 * view goes blank. The `framing-watch` viewer plugin detects that and emits
 * `camera:framing`; this surfaces a "Model out of view · Recenter" pill whose
 * button drives `camera.recenter` (gentle re-frame, preserving the view angle).
 *
 * It is pane-scoped (mounted inside the 3D-pane wrapper, so it clips to the pane
 * width in split) and `pointer-events-none` except for the pill itself, so the
 * user keeps navigating; it disappears once the model is framed again.
 */
export function ModelOutOfViewIndicator({ handle, viewerReady, active }: Props): JSX.Element | null {
  const t = useTranslations('viewer.framing');
  const [outOfView, setOutOfView] = useState(false);

  useEffect(() => {
    if (!handle || !viewerReady || !active) {
      setOutOfView(false);
      return undefined;
    }
    // `empty` (no model) is not a "lost the model" state — never show the pill for it.
    const apply = (s: FramingEvent | null): void => {
      setOutOfView(!!s && !s.inView && s.reason !== 'empty');
    };
    // Seed from the current state — the camera may be static on Split entry, so no
    // `camera:framing` would fire on its own.
    if (handle.commands.has('camera.getFramingState')) {
      void handle.commands
        .execute<FramingEvent>('camera.getFramingState')
        .then(apply)
        .catch(() => undefined);
    }
    const off = handle.events.on('camera:framing', (e) => {
      apply(e);
    });
    return () => {
      off();
      setOutOfView(false);
    };
  }, [handle, viewerReady, active]);

  const recenter = useCallback(() => {
    if (!handle) return;
    void handle.commands.execute(resolveRecenterCommand(handle)).catch(() => undefined);
    // Optimistically dismiss; the viewer re-emits camera:framing once it settles.
    setOutOfView(false);
  }, [handle]);

  if (!active || !outOfView) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-white/95 px-3 py-2 shadow-md backdrop-blur-xl dark:border-white/[0.08] dark:bg-[rgba(15,15,20,0.85)]">
        <AlertTriangle weight="fill" className="h-4 w-4 shrink-0 text-warning" />
        <span className="text-body3 font-medium text-foreground">{t('outOfView')}</span>
        <button
          type="button"
          onClick={recenter}
          title={t('recenterTooltip')}
          aria-label={t('recenterTooltip')}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-body3 font-medium text-primary-foreground hover:bg-primary-hover"
        >
          <Crosshair className="h-4 w-4" />
          {t('recenter')}
        </button>
      </div>
    </div>
  );
}
