'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';

import { useFeatureContent } from './useFeatureContent';

/**
 * "Frequently asked questions" band for a feature page. Renders the three Q&A
 * pairs from the per-feature JSON (`faq[]`) as an always-visible `<dl>` so every
 * answer is in the SSR HTML (the matching `FAQPage` JSON-LD is emitted from the
 * page server component for rich-result eligibility).
 */
export function FeatureFaq({ featureKey }: { featureKey: string }): JSX.Element | null {
  const tDetail = useTranslations('featureDetail');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { faq } = content;

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-12">
      <Reveal className="mb-8">
        <h2 className="text-title2 font-semibold text-foreground">{tDetail('faqHeading')}</h2>
      </Reveal>

      <dl className="flex max-w-3xl flex-col gap-6">
        {faq.map((item, i) => (
          <Reveal
            key={item.q}
            delay={i * 80}
            className="flex flex-col gap-2 border-b border-border pb-6 last:border-b-0"
          >
            <dt className="text-title3 font-semibold text-foreground">{item.q}</dt>
            <dd className="text-body1 leading-relaxed text-foreground-secondary">{item.a}</dd>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}
