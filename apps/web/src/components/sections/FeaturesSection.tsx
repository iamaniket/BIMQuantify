'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

import { FeatureCard } from './FeatureCard';
import { AVAILABLE_FEATURES, LAUNCHED } from './featureCatalog';

export function FeaturesSection(): JSX.Element {
  const t = useTranslations('features');

  return (
    <section id="features" className="mx-auto w-full max-w-8xl px-6 py-20">
      <SectionHeading
        eyebrow={t(LAUNCHED ? 'eyebrow' : 'prelaunchEyebrow')}
        headline={t(LAUNCHED ? 'headline' : 'prelaunchHeadline')}
        subtitle={t(LAUNCHED ? 'subtitle' : 'prelaunchSubtitle')}
      />

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {AVAILABLE_FEATURES.map(({ key, icon }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <FeatureCard featureKey={key} icon={icon} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
