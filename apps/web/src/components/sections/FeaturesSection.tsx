'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Card, CardBody, Eyebrow } from '@bimstitch/ui';

import { Reveal } from '@/components/shared/Reveal';

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AVAILABLE_FEATURES.map(({ key, icon: Icon }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <Card className="group h-full transition-shadow hover:shadow-lg">
              <CardBody className="gap-4">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                  <Icon className="h-6 w-6" aria-hidden />
                </div>
                <div className="space-y-2">
                  <h3 className="text-title3 font-semibold text-foreground">
                    {t(`${key}.title`)}
                  </h3>
                  <p className="text-body2 text-foreground-secondary">
                    {t(`${key}.body`)}
                  </p>
                </div>
              </CardBody>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
