'use client';

import type { EntityMarkerData, ViewerBundle, ViewerHandle } from '@bimstitch/viewer';
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { autoRotatePlugin } from './autoRotatePlugin';
import { cameraZoomPlugin } from './cameraZoomPlugin';
import { DEMO_MODEL_ID, DEMO_SNAGS } from './demoSnags';
import { monochromeLookPlugin } from './monochromeLookPlugin';

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

  const markers: EntityMarkerData[] = DEMO_SNAGS.map((snag) => ({
    id: snag.id,
    type: 'finding',
    position: snag.position,
    modelId: DEMO_MODEL_ID,
    entityId: snag.id,
    status: snag.status,
    // Just the title — the pin keeps its status-colored real-app style, and
    // both the hover tooltip and the click card show only the title.
    label: t(`snags.${snag.titleKey}`),
  }));

  const setPaused = (paused: boolean): void => {
    handleRef.current?.commands.execute('auto-rotate.setPaused', { paused }).catch(() => undefined);
  };

  const plugins = reducedMotion
    ? [monochromeLookPlugin(), cameraZoomPlugin({ animate: false })]
    : [monochromeLookPlugin(), cameraZoomPlugin(), autoRotatePlugin()];

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
      className="relative h-full w-full"
      // Pause the idle spin while the pointer is over the model so pin tooltips
      // stay readable; resume on leave. No-op under reduced motion.
      onPointerEnter={reducedMotion ? undefined : () => setPaused(true)}
      onPointerLeave={reducedMotion ? undefined : () => setPaused(false)}
    >
      <IfcViewer
        bundle={DEMO_BUNDLE}
        className="h-full w-full"
        builtInPlugins="minimal"
        background={{ alpha: 0 }}
        shadows={{ enabled: false }}
        viewCube={{ enabled: false }}
        // Disable wheel/scroll zoom (felt glitchy + would trap page scroll over
        // this full-bleed hero). camera-controls bails on ACTION.NONE before
        // preventDefault, so the page scrolls normally. Rotate/hover/pin-click
        // stay live; the initial framing is set once by `showcase.zoomIn`.
        controls={{ wheel: 'none' }}
        plugins={plugins}
        onReady={(handle) => {
          handleRef.current = handle;
          // Look, don't edit: disable model-element selection + hover highlight
          // so clicking/hovering the building paints nothing. Orbit/drag and the
          // idle auto-rotate are independent and stay live.
          void handle.commands.execute('selection.setEnabled', false).catch(() => undefined);
          void handle.commands.execute('hover.setEnabled', false).catch(() => undefined);
          // Frame the model, then dolly closer so it fills the canvas.
          void handle.commands
            .execute('camera.zoomExtents')
            .then(() => handle.commands.execute('showcase.zoomIn'))
            .catch(() => undefined);
          void handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
          // Clicking a pin toggles its title card (same id → dismiss).
          offClickRef.current = handle.events.on('entity-marker:click', (ev) => {
            setActiveSnagId((cur) => (cur === ev.id ? null : ev.id));
          });
          onLoaded?.();
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
