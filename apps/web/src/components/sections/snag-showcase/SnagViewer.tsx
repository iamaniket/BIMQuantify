'use client';

import type {
  EntityMarkerData, Vec3, ViewerBundle, ViewerHandle,
} from '@bimstitch/viewer';
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import {
  useCallback, useRef, useState, type JSX,
} from 'react';

import { autoRotatePlugin } from './autoRotatePlugin';
import { cameraDebugPlugin } from './cameraDebugPlugin';
import { cameraZoomPlugin } from './cameraZoomPlugin';
import { DEMO_MODEL_ID, DEMO_SNAGS, type DemoSnagStatus } from './demoSnags';
import { monochromeLookPlugin } from './monochromeLookPlugin';
import { snagPlacementPlugin, type ElementPointsArgs } from './snagPlacementPlugin';
import {
  snagSpotlightPlugin, type SnagAnchor, type SnagSpotlight,
} from './snagSpotlightPlugin';

// Self-contained demo model: a static fragments file shipped in apps/web/public,
// so the marketing site has NO runtime dependency on the API or MinIO. The
// viewer's WASM + worker are likewise served from apps/web's own /public.
const DEMO_BUNDLE: ViewerBundle = {
  fragmentsUrl: '/models/demo.frag',
  modelId: DEMO_MODEL_ID,
  cacheKey: 'web-demo-frag-v2',
};

// A snag reads as "broken" while it's open/in-progress, "fixed" once resolved or
// verified. Drives the status-pill color in the popover (the pin already encodes
// this via its ring color, shared with the real app).
const BROKEN_STATUSES = new Set<DemoSnagStatus>(['draft', 'open', 'in_progress']);

type Props = {
  /** When true, no idle auto-rotate and no popover pulse (prefers-reduced-motion). */
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
 * disabled in `onReady`, and the pins aren't clickable. As the model spins, the
 * snag whose pin is CLOSEST to the camera (facing the viewer) gets spotlit — its
 * other pins dim, a pulsing card pops over it, and it closes as the next snag
 * rotates to the front (camera-driven, see snagSpotlightPlugin). One at a time.
 */
export default function SnagViewer({ reducedMotion, onError, onLoaded }: Props): JSX.Element {
  const t = useTranslations('snagShowcase');
  const handleRef = useRef<ViewerHandle | null>(null);
  // Base markers (fixed positions/labels), built once in onReady. The spotlight
  // re-syncs these with only the `dimmed` flag toggled — an in-place restyle.
  const baseMarkersRef = useRef<EntityMarkerData[]>([]);
  // The popover wrapper; its transform is set imperatively every frame to track
  // the active pin's screen position (no React re-render for the per-frame move).
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Last id we pushed to React state — lets the per-frame callback skip setState
  // unless the spotlit snag actually changed.
  const activeIdRef = useRef<string | null>(null);
  const [activeSnagId, setActiveSnagId] = useState<string | null>(null);

  // Camera-tuning debug gate: on in dev, or on any build via `?camdebug`. Adds
  // the interaction-only `[snag-cam]` logger and enables wheel-zoom so you can
  // dolly the model to find `cameraZoomPlugin` knob values. Off → zero change
  // for real visitors (production keeps wheel disabled, no logger). SnagViewer
  // is `ssr:false`, so reading `window` here can't cause a hydration mismatch.
  const camDebug = process.env.NODE_ENV !== 'production'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('camdebug'));

  // The camera-spotlight reporter: called on every camera move with the frontmost
  // snag + where its pin projects on screen. Stable (refs only) so the plugin,
  // captured once at mount, always drives the latest DOM.
  const onSpotlight = useCallback((spotlight: SnagSpotlight | null): void => {
    if (spotlight === null) {
      activeIdRef.current = null;
      setActiveSnagId(null);
      return;
    }
    const el = popoverRef.current;
    if (el) {
      el.style.transform = `translate(${String(Math.round(spotlight.x))}px, ${String(Math.round(spotlight.y))}px)`;
    }
    if (spotlight.id !== activeIdRef.current) {
      activeIdRef.current = spotlight.id;
      setActiveSnagId(spotlight.id);
      // Dim every pin except the spotlit one (in-place restyle, no flicker).
      const markers = baseMarkersRef.current.map((m) => ({ ...m, dimmed: m.id !== spotlight.id }));
      handleRef.current?.commands.execute('entity-marker.sync', markers).catch(() => undefined);
    }
  }, []);

  // `sizeBoost` makes the model read bigger than a plain fit (distance ÷ boost).
  // The reveal is deferred until this framing lands (see onReady), so the model
  // appears already at this size — no zoom-in pop.
  const ZOOM = { sizeBoost: 1.5 } as const;
  const plugins = reducedMotion
    ? [
      monochromeLookPlugin(),
      cameraZoomPlugin({ ...ZOOM, animate: false }),
      snagPlacementPlugin(),
      snagSpotlightPlugin({ onSpotlight }),
    ]
    : [
      monochromeLookPlugin(),
      cameraZoomPlugin(ZOOM),
      autoRotatePlugin(),
      snagPlacementPlugin(),
      snagSpotlightPlugin({ onSpotlight }),
    ];
  if (camDebug) plugins.push(cameraDebugPlugin());

  const activeSnag = activeSnagId !== null
    ? (DEMO_SNAGS.find((s) => s.id === activeSnagId) ?? null)
    : null;
  const activeBroken = activeSnag !== null && BROKEN_STATUSES.has(activeSnag.status);

  return (
    <div
      // Full-bleed canvas — NO padding. The desktop right-shift (clearing the
      // text overlaid on the left) is done with the CAMERA in cameraZoomPlugin
      // (`setFocalOffset`, see `panFraction`), not a canvas `padding-left`.
      // Padding the canvas desynced its drawing buffer from
      // `getBoundingClientRect()` and broke `pick()` (the raycast that pins snags
      // to the model surface), so the pins floated on bounding-box centroids.
      // Keeping the canvas flush with the container keeps picking calibrated.
      className="relative h-full w-full"
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
          // Sample well-spread points that sit ON the model's visible surface
          // (raycast hits, the same anchor the real app stores for a finding),
          // then pin each snag to one (falling back to its authored coord only if
          // the raycast yields too few points). This keeps the pins stuck to the
          // building skin regardless of camera framing or the canvas pad.
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
              `[snag-debug] elementPoints returned ${String(points.length)}/${String(DEMO_SNAGS.length)} points`,
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
            // and both the hover tooltip and the popover show only the title.
            label: t(`snags.${snag.titleKey}`),
          }));
          baseMarkersRef.current = markers;
          await handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
          // Hand the placed anchors to the camera-spotlight plugin, which now
          // drives which snag is "active" by camera proximity on every frame.
          const anchors: SnagAnchor[] = markers.map((m) => ({
            id: m.id,
            position: m.position,
            modelId: m.modelId,
          }));
          await handle.commands.execute('showcase.setSnagAnchors', anchors).catch(() => undefined);
          // Reveal on the next frame so the final framing is painted before the
          // host fades the canvas in (onLoaded → opacity 0→100).
          requestAnimationFrame(() => onLoaded?.());
        }}
        onError={onError}
      />

      {/* Popover anchor — positioned at the active pin's projected screen point
          every frame via `popoverRef.style.transform` (set imperatively, NOT via
          a React `style` prop — otherwise each re-render would reset the
          transform and the card would jump for a frame). Its content is gated on
          `activeSnag`, which is only set AFTER the transform in the same callback,
          so it never paints at the corner before being positioned. Pointer-events
          off so it never blocks drag-to-rotate through the card. */}
      <div
        ref={popoverRef}
        aria-hidden={activeSnag === null}
        className="pointer-events-none absolute left-0 top-0 z-10 will-change-transform"
      >
        {activeSnag !== null && !reducedMotion && (
          // Radar-ping ring centered on the pin (the keyframe owns its centering
          // transform, so no Tailwind -translate here).
          <span
            aria-hidden
            className="animate-snag-pulse absolute left-0 top-0 h-9 w-9 rounded-full border-2 border-primary"
          />
        )}
        {activeSnag !== null && (
          // Outer = static positioning (center on the pin, lift above it); inner =
          // the pop animation, keyed on the snag id so it replays on every switch.
          <div className="absolute left-0 top-0 [transform:translate(-50%,calc(-100%-14px))]">
            <div
              key={activeSnag.id}
              className="animate-snag-pop relative flex min-w-[180px] max-w-[260px] flex-col gap-1.5 rounded-lg bg-surface-low px-3.5 py-2.5 shadow-lg ring-1 ring-border"
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
              {/* Caret pointing down to the pin. */}
              <span
                aria-hidden
                className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-low"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
