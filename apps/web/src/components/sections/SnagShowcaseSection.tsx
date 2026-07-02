'use client';

import {
  Button, Eyebrow, Tabs, TabsList, TabsTrigger,
} from '@bimdossier/ui';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState, type JSX } from 'react';

import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { env } from '@/lib/env';
import { portalHref } from '@/lib/portalLinks';

import { DEMO_SNAGS, type DemoSnagSeverity } from './snag-showcase/demoSnags';

type ShowcaseView = '3d' | '2d';

const SnagViewer = dynamic(() => import('./snag-showcase/SnagViewer'), {
  ssr: false,
  loading: () => <ShowcaseSkeleton />,
});

// The 2D chunk only fetches when the floor-plan tab is first opened (the tab
// conditionally mounts this component).
const FloorPlanViewer = dynamic(() => import('./snag-showcase/FloorPlanViewer'), {
  ssr: false,
  loading: () => <ShowcaseSkeleton />,
});

const SEVERITY_DOT: Record<DemoSnagSeverity, string> = {
  high: 'bg-error',
  medium: 'bg-warning',
  low: 'bg-info',
};

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

function ShowcaseSkeleton(): JSX.Element {
  // Match the section's bg so the transparent viewer canvas blends seamlessly —
  // surface-medium showed through the alpha:0 canvas as an off-color rectangle.
  // `z-10` keeps it ON TOP of the (transparent) canvas while the model loads and
  // frames, so the built-in zoom-extents excursion is never seen — the model is
  // revealed (via the fade below) only once it's already framed.
  return <div className="absolute inset-0 z-10 animate-pulse bg-surface-low" aria-hidden />;
}

function ShowcaseFallback(): JSX.Element {
  const t = useTranslations('snagShowcase');
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-auto p-5">
      <p className="text-body3 font-semibold text-foreground">{t('fallbackTitle')}</p>
      <p className="text-body3 text-foreground-tertiary">{t('fallbackBody')}</p>
      <ul className="mt-1 flex flex-col gap-2">
        {DEMO_SNAGS.map((snag) => (
          <li
            key={snag.id}
            className="flex items-start gap-2 rounded-lg bg-surface-low p-3 ring-1 ring-border"
          >
            <span
              aria-hidden
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[snag.severity]}`}
            />
            <div className="flex flex-col">
              <span className="text-body3 font-medium text-foreground">
                {t(`snags.${snag.titleKey}`)}
              </span>
              <span className="text-caption text-foreground-tertiary">
                {t('bblMeta', {
                  severity: t(`severity.${snag.severity}`),
                  article: snag.bblArticleRef,
                })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SnagShowcaseSection(): JSX.Element {
  const t = useTranslations('snagShowcase');
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  // Start fetching the viewer chunk slightly before the canvas scrolls in.
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '200px', once: true });

  const [webgl, setWebgl] = useState(true);
  const [view, setView] = useState<ShowcaseView>('3d');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setWebgl(hasWebGL());
  }, []);

  // Switching tabs swaps which viewer is mounted (keyed remount below), so reset
  // the fade gate — the new view re-reveals once it signals onLoaded.
  function changeView(next: ShowcaseView): void {
    if (next === view) return;
    setLoaded(false);
    setFailed(false);
    setView(next);
  }

  return (
    <section id="showcase" className="bg-surface-low">
      {/* Full-bleed hero: the <section> already spans the viewport, so the canvas
          just drops the max-w constraint. Mobile stacks (text above a shorter
          canvas); lg turns the canvas into a full-height backdrop with the text
          overlaid on the left. */}
      <div className="relative flex flex-col lg:block lg:h-[75vh] lg:min-h-[640px] lg:max-h-[860px]">
        {/* CANVAS LAYER — blueprint-corners adds the 12px crosshair frame ticks
            (one of exactly two placements, with the flagship Wkb card). */}
        <div
          ref={ref}
          className="blueprint-corners relative order-2 h-[55vh] min-h-[340px] w-full lg:order-none lg:absolute lg:inset-0 lg:h-full"
        >
          {!webgl || failed ? (
            <ShowcaseFallback />
          ) : !inView ? (
            <ShowcaseSkeleton />
          ) : (
            <>
              {/* Fade the active view in only once it signals it's framed
                  (3D onLoaded fires after showcase.zoomIn; 2D after the plan +
                  markers load), so it appears already sized — no load-time pop.
                  Keyed by `view` so a tab switch remounts and re-runs the fade. */}
              <div
                key={view}
                className={`h-full w-full transition-opacity duration-700 ${
                  loaded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {view === '3d' ? (
                  <SnagViewer
                    reducedMotion={reducedMotion}
                    onError={() => setFailed(true)}
                    onLoaded={() => setLoaded(true)}
                  />
                ) : (
                  <FloorPlanViewer
                    reducedMotion={reducedMotion}
                    onError={() => setFailed(true)}
                    onLoaded={() => setLoaded(true)}
                  />
                )}
              </div>
              {!loaded && <ShowcaseSkeleton />}
            </>
          )}

          {/* VIEW TOGGLE — floats over the canvas in both layouts. Hidden when
              the static fallback shows (no WebGL). The SAME demo snags render in
              both views (shared marker style), so the 2D caption makes the
              "one synced tool" point explicit. */}
          {webgl && !failed && (
            <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-1.5">
              <Tabs
                value={view}
                onValueChange={(v) => { changeView(v as ShowcaseView); }}
                className="pointer-events-auto"
              >
                <TabsList className="shadow-sm ring-1 ring-border">
                  <TabsTrigger value="3d" size="md">
                    {t('tab3d')}
                  </TabsTrigger>
                  <TabsTrigger value="2d" size="md">
                    {t('tab2d')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {view === '2d' && (
                <span className="rounded bg-surface-low px-1.5 py-0.5 text-caption text-foreground-tertiary ring-1 ring-border">
                  {t('plan2dHint')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* SCRIM — desktop only, left half, keeps the overlaid text legible over
            the canvas. from-token → transparent (no opacity-modifier needed). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-surface-low to-transparent lg:block lg:w-1/2"
        />

        {/* TEXT OVERLAY — click-through except the buttons, so dragging the whole
            canvas still orbits. Aligned to the page content width. */}
        <div className="pointer-events-none order-1 lg:order-none lg:absolute lg:inset-0 lg:z-10">
          <div className="mx-auto flex h-full max-w-8xl items-center px-6 pt-16 pb-10 lg:py-0">
            <div className="flex max-w-md flex-col gap-4">
              <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
              <h2 className="text-h3 font-semibold text-foreground">{t('headline')}</h2>
              <p className="text-body1 text-foreground-secondary">{t('subtitle')}</p>
              <ul className="flex flex-col gap-2 text-body2 text-foreground-secondary">
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {t('hintDrag')}
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {t('hintWatch')}
                </li>
              </ul>
              {/* Signup CTA is env-gated. Pre-launch the whole button row is
                  hidden — no fallback button, no blog link. */}
              {env.NEXT_PUBLIC_ENABLE_SIGNUP && (
                <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-4">
                  <a href={portalHref(locale, '/signup')}>
                    <Button variant="primary" size="lg">
                      {t('cta')}
                    </Button>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
