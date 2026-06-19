'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { ArrowRight } from '@bimstitch/ui/icons';

import { Reveal } from '@/components/shared/Reveal';
import { Link } from '@/i18n/navigation';

import { getFeatureContent } from './featureContent';

/**
 * "Related capabilities" strip — three cross-links to sibling feature pages.
 * Improves internal linking (SEO) and discovery between features. The related
 * slugs come from the per-feature JSON's `related` list; each card reuses the
 * sibling's title + short `card` copy and resolves its icon here so no component
 * crosses the server→client boundary.
 */
export function FeatureRelated({ featureKey }: { featureKey: string }): JSX.Element | null {
  const t = useTranslations('features');
  const tDetail = useTranslations('featureDetail');
  const locale = useLocale();
  const content = getFeatureContent(featureKey, locale);
  if (content === null) {
    return null;
  }
  const related = content.related.filter((key) => key !== featureKey);

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-12">
      <Reveal className="mb-8">
        <h2 className="text-title2 font-semibold text-foreground">{tDetail('relatedHeading')}</h2>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((key, i) => {
          const rc = getFeatureContent(key, locale);
          if (rc === null) {
            return null;
          }
          const Icon = rc.icon;
          return (
            <Reveal key={key} delay={i * 80} className="h-full">
              <Link
                href={`/features/${key}`}
                className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface-low p-5 transition-colors hover:border-primary hover:bg-background-hover"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="text-title3 font-semibold text-foreground">{rc.title}</h3>
                </div>
                <p className="text-body2 leading-relaxed text-foreground-secondary">{rc.card}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 text-body3 font-medium text-primary">
                  {t('readMore')}
                  <ArrowRight
                    className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
