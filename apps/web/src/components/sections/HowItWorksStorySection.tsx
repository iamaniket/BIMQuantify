'use client';

import { Eyebrow } from '@bimdossier/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import {
  useCallback, useEffect, useRef, useState, type JSX,
} from 'react';

import { SectionHeading } from '@/components/shared/SectionHeading';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';

import { HowItWorksStepsGrid, STEP_ICONS } from './how-it-works-story/HowItWorksStepsGrid';
import { STORY_STEPS } from './how-it-works-story/storySteps';

const StoryViewer = dynamic(() => import('./how-it-works-story/StoryViewer'), {
  ssr: false,
  loading: () => <StorySkeleton />,
});

/**
 * Step boundaries carry ±this much dead zone (in step units): the active step
 * only flips once scroll progress passes a boundary decisively, so a pixel
 * wiggle at a boundary never ping-pongs two camera flights.
 */
const HYSTERESIS = 0.04;

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

function StorySkeleton(): JSX.Element {
  // Match the section bg so the transparent viewer canvas blends seamlessly;
  // z-10 keeps it on top until the model is framed (same as the showcase).
  return <div className="absolute inset-0 z-10 animate-pulse bg-surface-low" aria-hidden />;
}

/**
 * The scroll-driven 3D "how it works" story — replaces the static six-step
 * grid (which lives on as the no-WebGL / load-failure fallback, see
 * HowItWorksStepsGrid). Classic scrollytelling: a sticky full-height viewer
 * canvas with six step panels scrolling over it. NO scroll-jack — native
 * scroll is never intercepted; the canvas is pointer-events-none (look-only;
 * the interactive playground remains the snag showcase above) and the viewer
 * merely reacts to `activeStep` / `intraStepT` derived from scroll progress.
 *
 * Progress mechanics: one passive scroll + resize listener, attached only
 * while the section is near the viewport (IO gate, rootMargin 50%). The
 * handler is rAF-coalesced — a single getBoundingClientRect read per frame —
 * and step flips carry ±0.04 hysteresis. `intraStepT` updates (epsilon-gated)
 * only while the dollhouse-cut step is active, so scrolling anywhere else in
 * the story re-renders nothing per frame.
 */
export function HowItWorksStorySection(): JSX.Element {
  const t = useTranslations('howItWorks');
  const reducedMotion = useReducedMotion();

  const [webgl, setWebgl] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [intraStepT, setIntraStepT] = useState(0);
  const activeStepRef = useRef(0);
  const intraRef = useRef(0);

  // Progress is measured on the sticky+panels wrapper (not the whole section,
  // whose heading would skew the 0..1 range). Three consumers share the node:
  // the measurement ref, the near gate (attaches the scroll listener), and the
  // mount gate (starts the ~6 MB viewer chunk fetch 600px early). threshold 0
  // matters — the wrapper is ~5 viewports tall, so a ratio threshold would
  // never trip.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { ref: nearRef, inView: near } = useInView<HTMLDivElement>({
    rootMargin: '50%', once: false, threshold: 0,
  });
  const { ref: mountRef, inView: nearMount } = useInView<HTMLDivElement>({
    rootMargin: '600px', once: true, threshold: 0,
  });
  const setWrapRef = useCallback((el: HTMLDivElement | null): void => {
    wrapRef.current = el;
    nearRef.current = el;
    mountRef.current = el;
  }, [nearRef, mountRef]);

  useEffect(() => {
    setWebgl(hasWebGL());
  }, []);

  useEffect(() => {
    if (!near || !webgl || failed) return undefined;
    const el = wrapRef.current;
    if (el === null) return undefined;

    let raf = 0;
    const update = (): void => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(Math.max(-rect.top / scrollable, 0), 1);
      const total = STORY_STEPS.length;
      // Raw step position in 0..total (kept just under `total` so the last
      // step's floor never overflows the array).
      const raw = Math.min(progress * total, total - 0.001);

      const current = activeStepRef.current;
      let next = current;
      if (raw >= current + 1 + HYSTERESIS) {
        next = Math.min(total - 1, Math.floor(raw - HYSTERESIS));
      } else if (raw < current - HYSTERESIS) {
        next = Math.max(0, Math.floor(raw + HYSTERESIS));
      }
      if (next !== current) {
        activeStepRef.current = next;
        setActiveStep(next);
      }

      // Intra-step progress feeds ONLY the cut scrub — outside that step it
      // parks at 0 so per-frame scrolling causes zero re-renders.
      const stepDef = STORY_STEPS[next];
      if (stepDef?.cut === 'scrub') {
        const tIntra = Math.min(Math.max(raw - next, 0), 1);
        if (Math.abs(tIntra - intraRef.current) > 0.01) {
          intraRef.current = tIntra;
          setIntraStepT(tIntra);
        }
      } else if (intraRef.current !== 0) {
        intraRef.current = 0;
        setIntraStepT(0);
      }
    };
    const schedule = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [near, webgl, failed]);

  // No-WebGL / load-failure fallback: the preserved six-step grid — nothing
  // regresses for browsers that can't run the story.
  if (!webgl || failed) {
    return (
      <section id="how-it-works" className="bg-surface-low">
        <div className="mx-auto w-full max-w-8xl px-6 py-20">
          <SectionHeading eyebrow={t('eyebrow')} headline={t('headline')} />
          <HowItWorksStepsGrid />
        </div>
      </section>
    );
  }

  return (
    <section id="how-it-works" className="bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 pt-20 pb-4">
        <SectionHeading eyebrow={t('eyebrow')} headline={t('headline')} className="mb-0" />
      </div>

      <div ref={setWrapRef} className="relative">
        {/* STICKY CANVAS — pinned for the whole story while the panels scroll
            over it. Look-only (see StoryViewer): it never captures a pointer. */}
        <div
          className="sticky top-0 h-svh w-full overflow-hidden"
          role="img"
          aria-label={t('story.canvasLabel')}
        >
          {nearMount ? (
            <>
              {/* Fade in only once the first pose is framed (onLoaded), so the
                  model never pops mid-zoom — the showcase's reveal pattern. */}
              <div
                className={`h-full w-full transition-opacity duration-700 ${
                  loaded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <StoryViewer
                  activeStep={activeStep}
                  intraStepT={intraStepT}
                  reducedMotion={reducedMotion}
                  onError={() => setFailed(true)}
                  onLoaded={() => setLoaded(true)}
                />
              </div>
              {!loaded && <StorySkeleton />}
            </>
          ) : (
            <StorySkeleton />
          )}

          {/* PROGRESS RAIL — six dots tracking the active step. Decorative;
              each panel card carries the readable "Step n of 6" label. */}
          <div
            aria-hidden
            className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2 md:right-8"
          >
            {STORY_STEPS.map((step, i) => (
              <span
                key={step.key}
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none ${
                  i === activeStep ? 'bg-primary' : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        {/* STEP PANELS — scroll over the pinned canvas (-mt pulls them onto
            it). Text is server-rendered, so no-JS/SEO reads all six steps.
            Cards sit left on lg (the director shifts the model right) and
            bottom-anchored below lg (the director lifts the model up). */}
        <div className="relative z-10 -mt-[100svh]">
          {STORY_STEPS.map((step, i) => (
            <div key={step.key} className="flex min-h-[90svh] items-end lg:items-center">
              <div className="mx-auto w-full max-w-8xl px-6 pb-24 lg:pb-0">
                <div className="max-w-md rounded-xl bg-surface-low p-6 shadow-lg ring-1 ring-border">
                  <Eyebrow size="sm">
                    {t('story.stepLabel', { current: i + 1, total: STORY_STEPS.length })}
                  </Eyebrow>
                  <div className="mt-3 flex items-center gap-2 text-primary">
                    {STEP_ICONS[step.key]}
                    <h3 className="text-title3 font-semibold text-foreground">
                      {t(`${step.key}.title`)}
                    </h3>
                  </div>
                  <p className="mt-2 text-body2 text-foreground-secondary">
                    {t(`${step.key}.body`)}
                  </p>
                  {i === 0 && (
                    <p className="mt-4 flex items-center gap-2 text-body3 text-foreground-tertiary">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {t('story.scrollHint')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
