'use client';

import type { EntityMarkerData, ViewerBundle, ViewerHandle } from '@bimstitch/viewer';
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import { useRef, type JSX } from 'react';

import { autoRotatePlugin } from './autoRotatePlugin';
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
 * hardcoded snag pins (hover tooltips are built into the entity-marker plugin).
 */
export default function SnagViewer({ reducedMotion, onError, onLoaded }: Props): JSX.Element {
  const t = useTranslations('snagShowcase');
  const handleRef = useRef<ViewerHandle | null>(null);

  const markers: EntityMarkerData[] = DEMO_SNAGS.map((snag) => ({
    id: snag.id,
    type: 'finding',
    position: snag.position,
    modelId: DEMO_MODEL_ID,
    entityId: snag.id,
    status: snag.status,
    label: `${t(`severity.${snag.severity}`)} · ${t(`snags.${snag.titleKey}`)} · Bbl ${snag.bblArticleRef}`,
  }));

  const setPaused = (paused: boolean): void => {
    handleRef.current?.commands.execute('auto-rotate.setPaused', { paused }).catch(() => undefined);
  };

  const plugins = reducedMotion
    ? [monochromeLookPlugin()]
    : [monochromeLookPlugin(), autoRotatePlugin()];

  return (
    <div
      className="h-full w-full"
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
        plugins={plugins}
        onReady={(handle) => {
          handleRef.current = handle;
          void handle.commands.execute('camera.zoomExtents').catch(() => undefined);
          void handle.commands.execute('entity-marker.sync', markers).catch(() => undefined);
          onLoaded?.();
        }}
        onError={onError}
      />
    </div>
  );
}
