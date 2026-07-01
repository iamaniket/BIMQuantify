'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

import { ComingSoonCard } from './ComingSoonCard';
import { ROADMAP_FEATURES } from './featureCatalog';

export function RoadmapSection(): JSX.Element {
  const t = useTranslations('roadmap');

  return (
    <section id="roadmap" className="mx-auto w-full max-w-8xl px-6 py-20">
      <SectionHeading
        eyebrow={t('eyebrow')}
        headline={t('headline')}
        subtitle={t('subtitle')}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROADMAP_FEATURES.map(({ key, icon: Icon }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <ComingSoonCard
              icon={Icon}
              title={t(`items.${key}.title`)}
              body={t(`items.${key}.body`)}
              badge={t('badge')}
            />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
