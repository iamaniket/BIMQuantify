'use client';

import { Button, Eyebrow } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState, type JSX } from 'react';

import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Link } from '@/i18n/navigation';

import { DEMO_SNAGS, type DemoSnagSeverity } from './snag-showcase/demoSnags';

const SnagViewer = dynamic(() => import('./snag-showcase/SnagViewer'), {
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
  return <div className="absolute inset-0 animate-pulse bg-surface-medium" aria-hidden />;
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
                {t(`severity.${snag.severity}`)} · Bbl {snag.bblArticleRef}
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
  const reducedMotion = useReducedMotion();
  // Start fetching the viewer chunk slightly before the canvas scrolls in.
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '200px', once: true });

  const [webgl, setWebgl] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setWebgl(hasWebGL());
  }, []);

  return (
    <section id="showcase" className="bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-5">
          <div className="flex flex-col gap-4 lg:col-span-2">
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
                {t('hintHover')}
              </li>
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link href="/request-access">
                <Button variant="primary" size="lg">
                  {t('cta')}
                </Button>
              </Link>
              <Link
                href="/blog"
                className="text-body2 font-medium text-primary hover:underline"
              >
                {t('learnMoreBlog')}
              </Link>
            </div>
          </div>

          <div
            ref={ref}
            className="relative aspect-[4/3] w-full lg:col-span-3 lg:aspect-[3/2]"
          >
            {!webgl || failed ? (
              <ShowcaseFallback />
            ) : !inView ? (
              <ShowcaseSkeleton />
            ) : (
              <>
                {!loaded && <ShowcaseSkeleton />}
                <SnagViewer
                  reducedMotion={reducedMotion}
                  onError={() => setFailed(true)}
                  onLoaded={() => setLoaded(true)}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
