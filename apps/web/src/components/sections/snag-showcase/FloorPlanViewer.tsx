'use client';

import { DocumentViewer } from '@bimdossier/viewer/viewer-2d';
import type {
  DocumentViewerHandle, EntityMarker2DData,
} from '@bimdossier/viewer/viewer-2d';
import { useTranslations } from 'next-intl';
import {
  useEffect, useMemo, useRef, useState, type JSX,
} from 'react';

import { loadDemoFloorPlan, PLAN_SNAG_IDS, type DemoFloorPlanData } from './demoFloorPlan';
import { DEMO_SNAGS, type DemoSnagStatus } from './demoSnags';

// A snag reads as "broken" while open/in-progress, "fixed" once resolved or
// verified — same split as SnagViewer, drives the status pill color in the card.
const BROKEN_STATUSES = new Set<DemoSnagStatus>(['draft', 'open', 'in_progress']);

/** The curated snags shown on the plan (positions are computed at load). */
const PLAN_SNAG_ID_SET = new Set<string>(PLAN_SNAG_IDS);
const PLAN_SNAGS = DEMO_SNAGS.filter((s) => PLAN_SNAG_ID_SET.has(s.id));

/** Locked camera: a static "look" plan that never hijacks page scroll. */
const PLAN_CONTROLS = {
  left: 'none',
  middle: 'none',
  right: 'none',
  wheel: 'none',
} as const;

/**
 * Resolve a Tailwind text-color utility to a concrete `rgb()` for WebGL/canvas
 * use, so the plan honors the active light/dark theme tokens (mirrors the
 * portal's `resolveColor`). Returns a neutral fallback during SSR — this
 * component is `ssr:false`, so `document` is present at render.
 */
function resolveColor(className: string): string {
  if (typeof document === 'undefined') return '#888';
  const probe = document.createElement('span');
  probe.className = className;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color || '#888';
}

type Props = {
  /** When true, no card pop animation (prefers-reduced-motion). */
  reducedMotion: boolean;
  /** Called on any load failure so the host can swap in the static fallback. */
  onError: () => void;
  /** Called once the plan has loaded and markers are synced. */
  onLoaded?: () => void;
};

/**
 * The 2D half of the showcase — dynamically imported (`ssr:false`) so the viewer
 * chunk only loads when the 2D tab is first opened. Renders a hand-authored demo
 * floor plan through the REAL product 2D engine (`@bimdossier/viewer/viewer-2d`)
 * and pins the SAME demo snags onto it (same ids / titles / statuses, and the
 * marker style is shared with the 3D plugin — `findingMarkerStyle.ts`). Picking
 * a pin shows a small inspector card; hovering shows the engine's own tooltip.
 *
 * Camera interaction is locked (look, don't edit) so the plan stays framed and
 * wheel events never hijack the page scroll over this full-bleed hero.
 */
export default function FloorPlanViewer({ reducedMotion, onError, onLoaded }: Props): JSX.Element | null {
  const t = useTranslations('snagShowcase');
  const handleRef = useRef<DocumentViewerHandle | null>(null);
  const syncedRef = useRef(false);
  const [activeSnagId, setActiveSnagId] = useState<string | null>(null);
  // The real ground-floor plan + auto-placed snag positions, decoded at mount
  // from the static artifact. Null until ready (the host shows its skeleton).
  const [data, setData] = useState<DemoFloorPlanData | null>(null);

  // Keep the latest onError without re-running the one-shot load effect (the
  // host passes a fresh closure each render).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Decode the real floor plan once. On any failure the host swaps in the
  // static snag-list fallback (same as the 3D viewer's onError path).
  useEffect(() => {
    let cancelled = false;
    loadDemoFloorPlan()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) onErrorRef.current(); });
    return () => { cancelled = true; };
  }, []);

  // Theme-resolved plan colors (re-resolved when the locale-driven remount runs;
  // a theme switch remounts the section, so this stays correct).
  const colors = useMemo(
    () => ({
      wall: resolveColor('text-foreground'),
      room: resolveColor('text-foreground-tertiary'),
      label: resolveColor('text-foreground-secondary'),
      accent: resolveColor('text-primary'),
    }),
    [],
  );

  // Reflect a pin click into the inspector card. Re-runs once `data` lands —
  // the DocumentViewer (and so `handleRef.current`) only mounts after the plan
  // decodes, so subscribing at first render would miss the handle.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return undefined;
    const off = handle.events.on('entity-marker:click', ({ id }) => {
      setActiveSnagId(id);
    });
    return off;
  }, [data]);

  const activeSnag = activeSnagId !== null
    ? (PLAN_SNAGS.find((s) => s.id === activeSnagId) ?? null)
    : null;
  const activeBroken = activeSnag !== null && BROKEN_STATUSES.has(activeSnag.status);

  // Nothing to draw until the real plan decodes — the host shows its skeleton.
  if (data === null) return null;

  return (
    <div className="relative h-full w-full">
      <DocumentViewer
        ref={handleRef}
        floorPlan={data.plan}
        // Room-name labels are intentionally omitted: the engine sizes them to a
        // constant screen size off a `camera:change`, which never fires here (the
        // camera is locked and the initial fit is non-animated), so they'd render
        // ~70x oversized. The plan reads cleanly as walls + status pins.
        colors={colors}
        currentPage={1}
        navCompass={{ enabled: false }}
        // Look, don't edit: lock the camera so the plan stays framed and the
        // wheel never hijacks page scroll over the full-bleed hero. Pins stay
        // hoverable/clickable (their pointer handlers are independent).
        controls={PLAN_CONTROLS}
        // Desktop: offset the viewer box to the right ~62% so the plan fits
        // there and clears the hero text overlaid on the left (mirrors how the
        // 3D model is shifted right). Mobile stacks, so it stays full-width.
        className="absolute inset-0 lg:left-[38%]"
        // Sync the pins on the FIRST page render, NOT onLoaded. onLoaded fires
        // before the floor-plan camera fit, so markers added then are scaled
        // against the default page frustum and render ~60x oversized. By
        // page:rendered the plan has fitted, so worldPerPx is correct and the
        // pins get their true constant-screen size immediately.
        onPageRendered={() => {
          if (syncedRef.current) return;
          syncedRef.current = true;
          const handle = handleRef.current;
          if (handle) {
            const markers: EntityMarker2DData[] = [];
            for (const snag of PLAN_SNAGS) {
              const pos = data.snagPositions[snag.id];
              if (pos) {
                markers.push({
                  id: snag.id,
                  type: 'finding',
                  x: pos.x,
                  y: pos.y,
                  label: t(`snags.${snag.titleKey}`),
                  entityId: snag.id,
                  status: snag.status,
                });
              }
            }
            handle.commands.execute('entity-marker-2d.sync', markers).catch(() => undefined);
          }
          // Pre-select the first snag so the inspector card shows context
          // immediately (parity with the 3D view's always-on popover).
          const first = PLAN_SNAGS[0];
          setActiveSnagId(first ? first.id : null);
          onLoaded?.();
        }}
        onError={onError}
      />

      {/* Inspector card — anchored bottom-right so it clears the hero text on the
          left. Shows the picked snag with the same status pill as the 3D card. */}
      {activeSnag !== null && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10">
          <div
            key={activeSnag.id}
            className={`flex min-w-[180px] max-w-[260px] flex-col gap-1.5 rounded-lg bg-surface-low px-3.5 py-2.5 shadow-lg ring-1 ring-border ${
              reducedMotion ? '' : 'animate-snag-pop'
            }`}
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
                  {'✓'}
                </span>
              )}
              <span className={activeBroken ? 'text-foreground-secondary' : 'text-success'}>
                {t(`status.${activeSnag.status}`)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
