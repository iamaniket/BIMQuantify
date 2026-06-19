'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

import { Reveal } from '@/components/shared/Reveal';

import { FeatureCard } from './FeatureCard';
import { AVAILABLE_FEATURES } from './featureCatalog';

export function FeaturesSection(): JSX.Element {
  const t = useTranslations('features');

  return (
    <section id="features" className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="mb-12 flex flex-col items-center gap-3 text-center">
        <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
        <h2 className="max-w-2xl text-h3 font-semibold text-foreground">
          {t('headline')}
        </h2>
        <p className="max-w-xl text-body1 text-foreground-secondary">
          {t('subtitle')}
        </p>
      </div>

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
