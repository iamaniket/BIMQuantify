'use client';

import type { EntityMarkerData, Vec3, ViewerBundle, ViewerHandle } from '@bimstitch/viewer';
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { autoRotatePlugin } from './autoRotatePlugin';
import { cameraDebugPlugin } from './cameraDebugPlugin';
import { cameraZoomPlugin } from './cameraZoomPlugin';
import { DEMO_MODEL_ID, DEMO_SNAGS } from './demoSnags';
import { monochromeLookPlugin } from './monochromeLookPlugin';
import { snagPlacementPlugin, type SurfacePointsArgs } from './snagPlacementPlugin';

// Self-contained demo model: a static fragments file shipped in apps/web/public,
// so the marketing site has NO runtime dependency on the API or MinIO. The
// viewer's WASM + worker are likewise served from apps/web's own /public.
const DEMO_BUNDLE: ViewerBundle = {
  fragmentsUrl: '/models/demo.frag',
  modelId: DEMO_MODEL_ID,
  cacheKey: 'web-demo-frag-v2',
};

type Props = {
  /** When true, no idle auto-rotate (prefers-reduced-motion). */
  reducedMotion: boolean;
  /** Called on any load failure so the host can swap in the static fallback. */
  onError: () => void;
  /** Called once the model has loaded and markers are synced. */
  onLoaded?: () => void;
};

/**
 * The heavy half of the showcase — dynamically imported (`ssr:false`) so the
 * ~6 MB viewer chunk only loads when the section scrolls into view. Loads a
 * static, monochrome-rendered model with transparent background and the
 * hardcoded snag pins.
 *
 * It's a look-but-don't-edit hero: model-element selection + hover highlight
 * are disabled in `onReady`, so dragging/auto-rotate stay live but clicking the
 * building does nothing. The only interaction is the snag pins — clicking one
 * toggles a small card showing just its title.
 */
export default function SnagViewer({ reducedMotion, onError, onLoaded }: Props): JSX.Element {
  const t = useTranslations('snagShowcase');
  const handleRef = useRef<ViewerHandle | null>(null);
  const offClickRef = useRef<(() => void) | null>(null);
  const [activeSnagId, setActiveSnagId] = useState<string | null>(null);

  // Camera-tuning debug gate: on in dev, or on any build via `?camdebug`. Adds
  // the interaction-only `[snag-cam]` logger and enables wheel-zoom so you can
  // dolly the model to find `cameraZoomPlugin` knob values. Off → zero change
  // for real visitors (production keeps wheel disabled, no logger). SnagViewer
  // is `ssr:false`, so reading `window` here can't cause a hydration mismatch.
  const camDebug =
    process.env.NODE_ENV !== 'production' ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('camdebug'));

  // `sizeBoost` makes the model read bigger than a plain fit (distance ÷ boost).
  // The reveal is deferred until this framing lands (see onReady), so the model
  // appears already at this size — no zoom-in pop.
  const ZOOM = { sizeBoost: 1.5 } as const;
  const plugins = reducedMotion
    ? [monochromeLookPlugin(), cameraZoomPlugin({ ...ZOOM, animate: false }), snagPlacementPlugin()]
    : [monochromeLookPlugin(), cameraZoomPlugin(ZOOM), autoRotatePlugin(), snagPlacementPlugin()];
  if (camDebug) plugins.push(cameraDebugPlugin());

  // Dismiss the title card on Escape; tear down the marker-click subscription
  // on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setActiveSnagId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offClickRef.current?.();
      offClickRef.current = null;
    };
  }, []);

  const activeSnag =
    activeSnagId !== null ? (DEMO_SNAGS.find((s) => s.id === activeSnagId) ?? null) : null;

  return (
    <div
      // Desktop only: pad the WebGL canvas 500px on the left so the model renders
      // toward the right (clearing the text overlaid on the left). Gated to `lg`
      // so it never pushes the model off a narrow phone screen — mobile stays
      // centered. The model itself is camera-centered (no focal offset).
      className="relative h-full w-full lg:[&_canvas]:pl-[500px]"
    >
      <IfcViewer
        // Forward the handle ref: `onReady` is only invoked once IfcViewer's
        // imperative handle exists, and React skips `useImperativeHandle`
        // entirely when no ref is forwarded. Without this, `onReady` never
        // fires — so `showcase.zoomIn` (the bigger framing), the marker sync,
        // and the selection/hover disable all silently no-op, leaving the model
        // at the small built-in `camera.zoomExtents` fit.
        ref={handleRef}
        bundle={DEMO_BUNDLE}
        className="h-full w-full"
        builtInPlugins="minimal"
        background={{ alpha: 0 }}
        shadows={{ enabled: false }}
        viewCube={{ enabled: false }}
        // Rotate-only turntable: drag rotates, panning + zoom are disabled. With
        // pan off the orbit target can never be knocked off the model center, so
        // the idle auto-rotate always spins around the building's center. wheel
        // 'none' keeps page scroll working over this full-bleed hero (camera-
        // controls bails on ACTION.NONE before preventDefault). Touch is locked
        // to rotate-only inside cameraZoomPlugin (the prop can't reach touch).
        controls={{ left: 'rotate', middle: 'none', right: 'none', wheel: 'none' }}
        plugins={plugins}
        onReady={async (handle) => {
          handleRef.current = handle;
          // Debug gate: expose the handle so you can re-run framing or read the
          // camera/model state from the console after editing knobs, e.g.
          // `__snagViewer.commands.execute('showcase.debug.snapshot')`.
          if (camDebug && typeof window !== 'undefined') {
            (window as unknown as { __snagViewer?: ViewerHandle }).__snagViewer = handle;
          }
          // Look, don't edit: disable model-element selection + hover highlight
          // so clicking/hovering the building paints nothing. Orbit/drag and the
          // idle auto-rotate are independent and stay live.
          await handle.commands.execute('selection.setEnabled', false).catch(() => undefined);
          await handle.commands.execute('hover.setEnabled', false).catch(() => undefined);
          // Frame the model in one self-contained move (center pivot + tilt +
          // zoom + right-shift). AWAITED so the reveal below only happens once
          // the showcase framing has landed — this is what hides the built-in
          // `camera.zoomExtents` excursion that runs just before onReady, so the
          // model fades in already framed instead of popping/zooming.
          await handle.commands.execute('showcase.zoomIn').catch(() => undefined);
          // Raycast well-spread points ON the framed model's surface, then pin
          // each snag to one (falling back to its authored coord if a probe
          // misses, so a pin is never dropped). This is what keeps the pins on
          // the building instead of floating at the old hardcoded coordinates.
          const points = await handle.commands
            .execute<Vec3[]>('showcase.surfacePoints', {
              count: DEMO_SNAGS.length,
              modelId: DEMO_MODEL_ID,
            } satisfies SurfacePointsArgs)
            .catch(() => [] as Vec3[]);
          const markers: EntityMarkerData[] = DEMO_SNAGS.map((snag, i) => ({
            id: snag.id,
            type: 'finding',
            position: points[i] ?? snag.position,
            modelId: DEMO_MODEL_ID,
            entityId: snag.id,
            status: snag.status,
            // Just the title — the pin keeps its status-colored real-app style,
            // and both the hover tooltip and the click card show only the title.
            label: t(`snags.${snag.titleKey}`),
          }));
          await handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
          // Clicking a pin toggles its title card (same id → dismiss).
          offClickRef.current = handle.events.on('entity-marker:click', (ev) => {
            setActiveSnagId((cur) => (cur === ev.id ? null : ev.id));
          });
          // Reveal on the next frame so the final framing is painted before the
          // host fades the canvas in (onLoaded → opacity 0→100).
          requestAnimationFrame(() => onLoaded?.());
        }}
        onError={onError}
      />

      {activeSnag !== null && (
        <div className="absolute bottom-4 right-4 z-10 flex max-w-[260px] items-start gap-2 rounded-lg bg-surface-low px-3 py-2 shadow-lg ring-1 ring-border">
          <span className="text-body3 font-medium text-foreground">
            {t(`snags.${activeSnag.titleKey}`)}
          </span>
          <button
            type="button"
            aria-label={t('dismissSnag')}
            onClick={() => setActiveSnagId(null)}
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-body3 text-foreground-tertiary transition-colors hover:text-foreground"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
