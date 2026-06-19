'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Card, CardBody, Eyebrow } from '@bimstitch/ui';

import { Reveal } from '@/components/shared/Reveal';

import { ROADMAP_FEATURES } from './featureCatalog';

export function RoadmapSection(): JSX.Element {
  const t = useTranslations('roadmap');

  return (
    <section id="roadmap" className="mx-auto w-full max-w-8xl px-6 py-20">
      <div className="mb-12 flex flex-col items-center gap-3 text-center">
        <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
        <h2 className="max-w-2xl text-h3 font-semibold text-foreground">
          {t('headline')}
        </h2>
        <p className="max-w-xl text-body1 text-foreground-secondary">
          {t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROADMAP_FEATURES.map(({ key, icon: Icon }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <Card className="h-full opacity-60">
              <CardBody className="gap-4">
                <div className="flex items-start justify-between">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-background-tertiary text-foreground-tertiary">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <Badge variant="default" size="sm">
                    {t('badge')}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <h3 className="text-title3 font-semibold text-foreground-tertiary">
                    {t(`items.${key}.title`)}
                  </h3>
                  <p className="text-body2 text-foreground-disabled">
                    {t(`items.${key}.body`)}
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
