'use client';

import { Eyebrow } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { StatCounter } from '@/components/shared/StatCounter';

type Metric = { value: number; suffix?: string; labelKey: string };

// Illustrative figures — labelled as such via the `caption` string. Numbers
// live here (locale-formatted at runtime); only the labels are translated.
const METRICS: Metric[] = [
  { value: 12000, suffix: '+', labelKey: 'snagsResolved' },
  { value: 98, suffix: '%', labelKey: 'compliancePassed' },
  { value: 150, suffix: '+', labelKey: 'projects' },
  { value: 9, suffix: ' d', labelKey: 'avgDaysToClose' },
];

export function MetricsSection(): JSX.Element {
  const t = useTranslations('metrics');

  return (
    <section className="bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
          <h2 className="text-h3 font-semibold text-foreground">{t('headline')}</h2>
        </div>
        <Reveal>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {METRICS.map((metric) => (
              <StatCounter
                key={metric.labelKey}
                value={metric.value}
                label={t(metric.labelKey)}
                {...(metric.suffix ? { suffix: metric.suffix } : {})}
              />
            ))}
          </div>
        </Reveal>
        <p className="mt-6 text-center text-body3 text-foreground-tertiary">{t('caption')}</p>
      </div>
    </section>
  );
}
