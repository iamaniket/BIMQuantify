'use client';

import type {
  EntityMarkerData, Vec3, ViewerBundle, ViewerHandle,
} from '@bimstitch/viewer';
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import {
  useEffect, useRef, useState, type JSX,
} from 'react';

import { autoRotatePlugin } from './autoRotatePlugin';
import { cameraDebugPlugin } from './cameraDebugPlugin';
import { cameraZoomPlugin } from './cameraZoomPlugin';
import { DEMO_MODEL_ID, DEMO_SNAGS, type DemoSnagStatus } from './demoSnags';
import { monochromeLookPlugin } from './monochromeLookPlugin';
import { snagPlacementPlugin, type ElementPointsArgs } from './snagPlacementPlugin';

// Self-contained demo model: a static fragments file shipped in apps/web/public,
// so the marketing site has NO runtime dependency on the API or MinIO. The
// viewer's WASM + worker are likewise served from apps/web's own /public.
const DEMO_BUNDLE: ViewerBundle = {
  fragmentsUrl: '/models/demo.frag',
  modelId: DEMO_MODEL_ID,
  cacheKey: 'web-demo-frag-v2',
};

// A snag reads as "broken" while it's open/in-progress, "fixed" once resolved or
// verified. Drives the status-pill color in the spotlight card (the pin already
// encodes this via its ring color, shared with the real app).
const BROKEN_STATUSES = new Set<DemoSnagStatus>(['draft', 'open', 'in_progress']);

// How long each snag stays spotlit before the cycle advances.
const CYCLE_MS = 2800;
// After the user stops dragging, wait this long before resuming the cycle.
const RESUME_DELAY_MS = 1400;

type Props = {
  /** When true, no idle auto-rotate and no spotlight cycle (prefers-reduced-motion). */
  reducedMotion: boolean;
  /** Called on any load failure so the host can swap in the static fallback. */
  onError: () => void;
  /** Called once the model has loaded and markers are synced. */
  onLoaded?: () => void;
};

/**
 * The heavy half of the showcase — dynamically imported (`ssr:false`) so the
 * ~6 MB viewer chunk only loads when the section scrolls into view. Loads a
 * static, monochrome-rendered model with transparent background and snag pins
 * placed on real element geometry (see snagPlacementPlugin).
 *
 * It's a look-but-don't-edit hero: model-element selection + hover highlight are
 * disabled in `onReady`, and the pins aren't clickable. Instead a spotlight
 * auto-cycle walks through the snags — dimming the others, highlighting the
 * active one, and popping a card with its title + broken/fixed status. The cycle
 * pauses while the user drags. Skipped entirely under reduced motion.
 */
export default function SnagViewer({ reducedMotion, onError, onLoaded }: Props): JSX.Element {
  const t = useTranslations('snagShowcase');
  const handleRef = useRef<ViewerHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Base markers (fixed positions/labels), built once in onReady. The cycle
  // re-syncs these with only the `dimmed` flag toggled — an in-place restyle.
  const baseMarkersRef = useRef<EntityMarkerData[]>([]);
  // While true (user dragging) the cycle holds on the current snag.
  const pausedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [activeSnagId, setActiveSnagId] = useState<string | null>(null);

  // Camera-tuning debug gate: on in dev, or on any build via `?camdebug`. Adds
  // the interaction-only `[snag-cam]` logger and enables wheel-zoom so you can
  // dolly the model to find `cameraZoomPlugin` knob values. Off → zero change
  // for real visitors (production keeps wheel disabled, no logger). SnagViewer
  // is `ssr:false`, so reading `window` here can't cause a hydration mismatch.
  const camDebug = process.env.NODE_ENV !== 'production'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('camdebug'));

  // `sizeBoost` makes the model read bigger than a plain fit (distance ÷ boost).
  // The reveal is deferred until this framing lands (see onReady), so the model
  // appears already at this size — no zoom-in pop.
  const ZOOM = { sizeBoost: 1.5 } as const;
  const plugins = reducedMotion
    ? [monochromeLookPlugin(), cameraZoomPlugin({ ...ZOOM, animate: false }), snagPlacementPlugin()]
    : [monochromeLookPlugin(), cameraZoomPlugin(ZOOM), autoRotatePlugin(), snagPlacementPlugin()];
  if (camDebug) plugins.push(cameraDebugPlugin());

  // Pause the spotlight cycle while the user is dragging the model, resuming a
  // beat after they let go (mirrors how autoRotatePlugin pauses on drag).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let resumeTimer: number | undefined;
    const onDown = (): void => {
      pausedRef.current = true;
      if (resumeTimer) window.clearTimeout(resumeTimer);
    };
    const onUp = (): void => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        pausedRef.current = false;
      }, RESUME_DELAY_MS);
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      if (resumeTimer) window.clearTimeout(resumeTimer);
    };
  }, []);

  // The spotlight cycle: once the model is framed and markers exist, walk through
  // the snags on a timer, dimming all but the active pin and showing its card.
  useEffect(() => {
    if (!ready || reducedMotion) return;
    let idx = 0;
    const tick = (): void => {
      if (pausedRef.current) return;
      const snag = DEMO_SNAGS[idx % DEMO_SNAGS.length];
      idx += 1;
      if (!snag) return;
      setActiveSnagId(snag.id);
      const markers = baseMarkersRef.current.map((m) => ({ ...m, dimmed: m.id !== snag.id }));
      handleRef.current?.commands.execute('entity-marker.sync', markers).catch(() => undefined);
    };
    tick(); // spotlight the first snag immediately
    const id = window.setInterval(tick, CYCLE_MS);
    return () => { window.clearInterval(id); };
  }, [ready, reducedMotion]);

  const activeSnag = activeSnagId !== null
    ? (DEMO_SNAGS.find((s) => s.id === activeSnagId) ?? null)
    : null;
  const activeBroken = activeSnag !== null && BROKEN_STATUSES.has(activeSnag.status);

  return (
    <div
      ref={containerRef}
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
        controls={{
          left: 'rotate', middle: 'none', right: 'none', wheel: 'none',
        }}
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
          // so clicking/hovering the building paints nothing, and the pins aren't
          // clickable. Orbit/drag and the idle auto-rotate stay live.
          await handle.commands.execute('selection.setEnabled', false).catch(() => undefined);
          await handle.commands.execute('hover.setEnabled', false).catch(() => undefined);
          // Frame the model in one self-contained move (center pivot + tilt +
          // zoom + right-shift). AWAITED so the reveal below only happens once
          // the showcase framing has landed — this is what hides the built-in
          // `camera.zoomExtents` excursion that runs just before onReady, so the
          // model fades in already framed instead of popping/zooming.
          await handle.commands.execute('showcase.zoomIn').catch(() => undefined);
          // Sample well-spread element centroids straight from the model geometry,
          // then pin each snag to one (falling back to its authored coord only if
          // geometry yields too few points). This keeps the pins ON the building
          // regardless of camera framing or the canvas pad.
          const points = await handle.commands
            .execute<Vec3[]>('showcase.elementPoints', {
              count: DEMO_SNAGS.length,
              modelId: DEMO_MODEL_ID,
            } satisfies ElementPointsArgs)
            .catch((err: unknown) => {
              if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.warn('[snag-debug] elementPoints command failed:', err);
              }
              return [] as Vec3[];
            });
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.warn(
              `[snag-debug] elementPoints returned ${points.length}/${DEMO_SNAGS.length} points`,
              points,
            );
          }
          const markers: EntityMarkerData[] = DEMO_SNAGS.map((snag, i) => ({
            id: snag.id,
            type: 'finding',
            position: points[i] ?? snag.position,
            modelId: DEMO_MODEL_ID,
            entityId: snag.id,
            status: snag.status,
            // Just the title — the pin keeps its status-colored real-app style,
            // and both the hover tooltip and the spotlight card show only the title.
            label: t(`snags.${snag.titleKey}`),
          }));
          baseMarkersRef.current = markers;
          await handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
          // Hand off to the spotlight cycle effect (no-op under reduced motion).
          setReady(true);
          // Reveal on the next frame so the final framing is painted before the
          // host fades the canvas in (onLoaded → opacity 0→100).
          requestAnimationFrame(() => onLoaded?.());
        }}
        onError={onError}
      />

      {activeSnag !== null && (
        <div
          key={activeSnag.id}
          className="animate-snag-pop absolute bottom-4 right-4 z-10 flex max-w-[280px] flex-col gap-1.5 rounded-lg bg-surface-low px-3.5 py-2.5 shadow-lg ring-1 ring-border"
        >
          <span className="text-body3 font-medium text-foreground">
            {t(`snags.${activeSnag.titleKey}`)}
          </span>
          <span className="flex items-center gap-1.5 text-caption font-medium">
            {activeBroken ? (
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${activeSnag.status === 'in_progress' ? 'bg-warning' : 'bg-error'}`}
              />
            ) : (
              <span aria-hidden className="text-success">
                ✓
              </span>
            )}
            <span className={activeBroken ? 'text-foreground-secondary' : 'text-success'}>
              {t(`status.${activeSnag.status}`)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
