'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

type FaqItem = { q: string; a: string };

/**
 * Homepage FAQ. Resolves the objections that peak right before the closing CTA:
 * what becoming a founding partner means, data/DPA, BIM-vs-PDF, instrument boundary,
 * tool fit, founding-partner cost. Mirrors the feature-page FAQ markup (`<dl>` so every answer is
 * in the SSR HTML) but reads its Q&A list from the homepage `faq.items` catalog
 * (en + nl) via `t.raw`.
 */
export function HomeFaqSection(): JSX.Element {
  const t = useTranslations('faq');
  const items = t.raw('items') as FaqItem[];

  return (
    <section id="faq" className="mx-auto w-full max-w-8xl px-6 py-20">
      <SectionHeading eyebrow={t('eyebrow')} headline={t('headline')} />

      <dl className="mx-auto flex max-w-3xl flex-col gap-6">
        {items.map((item, i) => (
          <Reveal
            key={item.q}
            delay={i * 60}
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
