'use client';

import type { EntityMarkerData, Vec3, ViewerHandle } from '@bimdossier/viewer';
import { IfcViewer, outlinePlugin } from '@bimdossier/viewer/viewer-3d';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useRef, useState, type JSX,
} from 'react';

import { cameraDebugPlugin } from '../snag-showcase/cameraDebugPlugin';
import { DEMO_BUNDLE } from '../snag-showcase/demoBundle';
import { DEMO_MODEL_ID, DEMO_SNAGS, type DemoSnagStatus } from '../snag-showcase/demoSnags';
import { monochromeLookPlugin } from '../snag-showcase/monochromeLookPlugin';
import { snagPlacementPlugin, type ElementPointsArgs } from '../snag-showcase/snagPlacementPlugin';
import {
  snagSpotlightPlugin, type SnagAnchor, type SnagSpotlight,
} from '../snag-showcase/snagSpotlightPlugin';
import {
  storyDirectorPlugin, type ApplyStepArgs, type SetCutArgs,
} from './storyDirectorPlugin';
import { STORY_DOC_MARKERS, STORY_STEPS, type StoryStep } from './storySteps';

// Mirrors SnagViewer: a snag reads as "broken" while open/in-progress. Drives
// the status-pill color in the step-3 popover.
const BROKEN_STATUSES = new Set<DemoSnagStatus>(['draft', 'open', 'in_progress']);

type Props = {
  /** Index into STORY_STEPS, derived from scroll progress by the host. */
  activeStep: number;
  /** 0..1 progress within the active step — drives the step-5 cut scrub. */
  intraStepT: number;
  /** When true, poses land instantly and the cut holds a fixed depth. */
  reducedMotion: boolean;
  /** Called on any load failure so the host can swap in the static grid. */
  onError: () => void;
  /** Called once the model has loaded and the first pose is framed. */
  onLoaded?: () => void;
};

/**
 * The heavy half of the scroll story — dynamically imported (`ssr:false`),
 * mirroring `SnagViewer`. Same demo bundle (same `cacheKey`, so the fragments
 * come from IndexedDB when the showcase loaded first), same monochrome +
 * hard-edge-outline look, but LOOK-ONLY: all camera controls are `none`, the
 * container is pointer-events-none (native scroll is never intercepted), and
 * the camera is driven exclusively by `storyDirectorPlugin` commands as the
 * host's `activeStep` / `intraStepT` props advance with scroll.
 */
export default function StoryViewer({
  activeStep, intraStepT, reducedMotion, onError, onLoaded,
}: Props): JSX.Element {
  const t = useTranslations('snagShowcase');
  const tStory = useTranslations('howItWorks.story');
  const handleRef = useRef<ViewerHandle | null>(null);
  // The popover wrapper; its transform is set imperatively on every camera
  // move to track the featured pin's screen position (no React re-render for
  // the per-frame move) — the SnagViewer pattern.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [activeSnagId, setActiveSnagId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Prop mirrors readable from `onReady` (captured once at mount) and the
  // director-facing effects below.
  const activeStepRef = useRef(activeStep);
  const intraStepTRef = useRef(intraStepT);
  useEffect(() => {
    activeStepRef.current = activeStep;
    intraStepTRef.current = intraStepT;
  }, [activeStep, intraStepT]);

  // Marker sets built once in onReady from on-model surface points.
  const snagMarkersRef = useRef<EntityMarkerData[]>([]);
  const docMarkersRef = useRef<EntityMarkerData[]>([]);
  // Which step's scene state has been applied — skips the re-fly when the
  // ready flip re-runs the step effect for a step onReady already staged.
  const appliedStepRef = useRef(-1);
  // Last cut position pushed to the director (epsilon gate).
  const lastCutTRef = useRef(-1);

  // Same debug gate as SnagViewer: on in dev, or on any build via `?camdebug`.
  const camDebug = process.env.NODE_ENV !== 'production'
    || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('camdebug'));

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
    }
  }, []);

  // Assemble the entity-marker set for a step. 'verified' re-syncs the same
  // finding ids with status verified — the entity-marker plugin restyles the
  // pins in place (no destroy/recreate), which is the step-6 "pins heal" beat.
  const markersFor = useCallback((set: StoryStep['markers']): EntityMarkerData[] => {
    const snags = snagMarkersRef.current;
    const docs = docMarkersRef.current;
    switch (set) {
      case 'none':
        return [];
      case 'snags':
        return snags;
      case 'snags+docs':
        return [...snags, ...docs];
      case 'verified':
        return [...snags.map((m) => ({ ...m, status: 'verified' })), ...docs];
    }
  }, []);

  // Push a step's scene state (pose + markers + cut mode) to the director.
  const applyStepState = useCallback(async (
    handle: ViewerHandle,
    stepIndex: number,
    animate: boolean,
  ): Promise<void> => {
    const step = STORY_STEPS[stepIndex];
    if (!step) return;
    await handle.commands
      .execute('story.applyStep', { camera: step.camera, animate } satisfies ApplyStepArgs)
      .catch(() => undefined);
    await handle.commands.execute('entity-marker.sync', markersFor(step.markers)).catch(() => undefined);
    if (step.cut === 'none') {
      await handle.commands
        .execute('story.setCut', { enabled: false, t: 0 } satisfies SetCutArgs)
        .catch(() => undefined);
    } else if (reducedMotion || step.cut === 'hold') {
      // Fixed mid-depth cut — reduced motion never scrubs.
      await handle.commands
        .execute('story.setCut', { enabled: true, t: 0.5 } satisfies SetCutArgs)
        .catch(() => undefined);
    } else {
      // 'scrub': force the next intraStepT through the epsilon gate so the
      // cut enables at the current scroll position.
      lastCutTRef.current = -1;
    }
  }, [markersFor, reducedMotion]);

  // Step transitions: one damped flight + marker/cut sync per activeStep
  // change. Scroll never scrubs the camera — camera-controls interrupts and
  // re-damps gracefully when steps change mid-flight.
  useEffect(() => {
    if (!ready) return;
    const handle = handleRef.current;
    if (handle === null) return;
    if (appliedStepRef.current === activeStep) return;
    appliedStepRef.current = activeStep;
    void applyStepState(handle, activeStep, !reducedMotion);
  }, [ready, activeStep, reducedMotion, applyStepState]);

  // The one continuous channel: intra-step progress drives the dollhouse cut
  // while the scrub step is active. Epsilon-gated so a sub-1% wiggle never
  // touches the scene.
  useEffect(() => {
    if (!ready || reducedMotion) return;
    const step = STORY_STEPS[activeStep];
    if (!step || step.cut !== 'scrub') return;
    if (Math.abs(intraStepT - lastCutTRef.current) < 0.01) return;
    lastCutTRef.current = intraStepT;
    void handleRef.current?.commands
      .execute('story.setCut', { enabled: true, t: intraStepT } satisfies SetCutArgs)
      .catch(() => undefined);
  }, [ready, activeStep, intraStepT, reducedMotion]);

  // The 'minimal' preset drops the built-in outline plugin; add it explicitly
  // with drawDuringMotion so the hard edges stay painted through the flights.
  const outline = outlinePlugin({ enabled: true, drawDuringMotion: true });
  const plugins = [
    monochromeLookPlugin(),
    outline,
    snagPlacementPlugin(),
    snagSpotlightPlugin({ onSpotlight }),
    storyDirectorPlugin(),
  ];
  if (camDebug) plugins.push(cameraDebugPlugin());

  const stepDef = STORY_STEPS[activeStep];
  const spotlightOn = ready && Boolean(stepDef?.spotlight);
  const activeSnag = spotlightOn && activeSnagId !== null
    ? (DEMO_SNAGS.find((s) => s.id === activeSnagId) ?? null)
    : null;
  const activeBroken = activeSnag !== null && BROKEN_STATUSES.has(activeSnag.status);

  return (
    <div
      // LOOK-ONLY: the canvas never captures a pointer, so native scroll and
      // touch pass straight through to the page (no scroll-jack by
      // construction). The `[&_*]` variant also neutralizes the CSS2D marker
      // wrappers, which set `pointer-events: auto` inline — the important
      // modifier is what outranks that inline style.
      className="pointer-events-none relative h-full w-full [&_*]:!pointer-events-none"
    >
      <IfcViewer
        // Forward the handle ref — onReady only fires when the imperative
        // handle exists (see the SnagViewer note on this exact trap).
        ref={handleRef}
        bundle={DEMO_BUNDLE}
        className="h-full w-full"
        builtInPlugins="minimal"
        background={{ alpha: 0 }}
        shadows={{ enabled: false }}
        viewCube={{ enabled: false }}
        // No user camera input at all — the story director owns the camera.
        controls={{
          left: 'none', middle: 'none', right: 'none', wheel: 'none',
        }}
        plugins={plugins}
        onReady={async (handle) => {
          handleRef.current = handle;
          // Debug gate: drive the story from the console for pose tuning and
          // rAF-free verification, e.g.
          // `__storyViewer.commands.execute('story.setCut', { enabled: true, t: 0.5 })`.
          if (camDebug && typeof window !== 'undefined') {
            (window as unknown as { __storyViewer?: ViewerHandle }).__storyViewer = handle;
          }
          // Look, don't edit — mirrors the showcase.
          await handle.commands.execute('selection.setEnabled', false).catch(() => undefined);
          await handle.commands.execute('hover.setEnabled', false).catch(() => undefined);
          // Frame the CURRENT step instantly (the visitor may have scrolled
          // mid-load) — also gives the placement raycasts a real camera pose.
          const initialStep = STORY_STEPS[activeStepRef.current] ?? STORY_STEPS[0];
          if (initialStep) {
            await handle.commands
              .execute('story.applyStep', {
                camera: initialStep.camera,
                animate: false,
              } satisfies ApplyStepArgs)
              .catch(() => undefined);
          }
          // Sample on-model surface points for snags AND doc markers in one
          // pass (same anchor mechanics as the showcase).
          const needed = DEMO_SNAGS.length + STORY_DOC_MARKERS.length;
          const points = await handle.commands
            .execute<Vec3[]>('showcase.elementPoints', {
              count: needed,
              modelId: DEMO_MODEL_ID,
            } satisfies ElementPointsArgs)
            .catch(() => [] as Vec3[]);
          snagMarkersRef.current = DEMO_SNAGS.map((snag, i) => ({
            id: snag.id,
            type: 'finding',
            position: points[i] ?? snag.position,
            modelId: DEMO_MODEL_ID,
            entityId: snag.id,
            status: snag.status,
            label: t(`snags.${snag.titleKey}`),
          }));
          docMarkersRef.current = STORY_DOC_MARKERS.flatMap((doc, i) => {
            const position = points[DEMO_SNAGS.length + i];
            if (!position) return [];
            return [{
              id: doc.id,
              type: doc.type,
              position,
              modelId: DEMO_MODEL_ID,
              entityId: doc.id,
              label: tStory(doc.labelKey),
            }];
          });
          // Featured pin (leftmost — elementPoints returns sorted points):
          // the step-3 dive target and the popover's single spotlight anchor.
          const featured = snagMarkersRef.current[0];
          if (featured) {
            await handle.commands
              .execute('story.setAnchor', {
                position: featured.position,
                modelId: featured.modelId,
              })
              .catch(() => undefined);
            const anchors: SnagAnchor[] = [{
              id: featured.id,
              position: featured.position,
              modelId: featured.modelId,
            }];
            await handle.commands.execute('showcase.setSnagAnchors', anchors).catch(() => undefined);
          }
          // Stage the current step's full scene state (an anchor pose can now
          // resolve, markers exist) before revealing; the step effect skips
          // this step thanks to appliedStepRef.
          appliedStepRef.current = activeStepRef.current;
          await applyStepState(handle, activeStepRef.current, false);
          setReady(true);
          // Reveal on the next frame so the framed pose is painted before the
          // host fades the canvas in.
          requestAnimationFrame(() => onLoaded?.());
        }}
        onError={onError}
      />

      {/* Step-3 popover over the featured pin — the exact SnagViewer pattern:
          transform set imperatively (never via a React style prop), content
          gated on the spotlight step so it pops as the camera dives in. */}
      <div
        ref={popoverRef}
        aria-hidden={activeSnag === null}
        className="pointer-events-none absolute left-0 top-0 z-10 will-change-transform"
      >
        {activeSnag !== null && !reducedMotion && (
          <span
            aria-hidden
            className="animate-snag-pulse absolute left-0 top-0 h-9 w-9 rounded-full border-2 border-primary"
          />
        )}
        {activeSnag !== null && (
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
                    {'✓'}
                  </span>
                )}
                <span className={activeBroken ? 'text-foreground-secondary' : 'text-success'}>
                  {t(`status.${activeSnag.status}`)}
                </span>
              </span>
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
