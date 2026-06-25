'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { CheckCircle } from '@bimdossier/ui/icons';

import { Reveal } from '@/components/shared/Reveal';

import { useFeatureContent } from './useFeatureContent';

/**
 * "Key capabilities" grid for a feature page. A four-card grid that breaks the
 * feature down into concrete, scannable capabilities — the main content/SEO
 * lift over the original three-block layout. Each card pairs a short title with
 * a one-to-two sentence body. Copy comes from the per-feature JSON
 * (`highlights[]`) resolved for the active locale.
 */
export function FeatureHighlights({ featureKey }: { featureKey: string }): JSX.Element | null {
  const tDetail = useTranslations('featureDetail');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { highlights } = content;

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-12">
      <Reveal className="mb-8">
        <h2 className="text-title2 font-semibold text-foreground">
          {tDetail('highlightsHeading')}
        </h2>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {highlights.map((item, i) => (
          <Reveal key={item.title} delay={i * 80} className="h-full">
            <div className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface-low p-5">
              <div className="flex items-center gap-2.5">
                <CheckCircle className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <h3 className="text-title3 font-semibold text-foreground">{item.title}</h3>
              </div>
              <p className="text-body2 leading-relaxed text-foreground-secondary">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
