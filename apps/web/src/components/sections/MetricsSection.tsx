'use client';

import { Eyebrow } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';

// These are the metrics we will report once the early-access pilots produce real
// numbers. Until then we show the labels with a muted placeholder rather than
// invented figures — see the `metrics.caption` string. When real data exists,
// restore the numbers via `components/shared/StatCounter` and flip the caption.
const METRIC_LABELS = [
  'snagsResolved',
  'compliancePassed',
  'projects',
  'avgDaysToClose',
] as const;

export function MetricsSection(): JSX.Element {
  const t = useTranslations('metrics');

  return (
    <section className="bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 py-16">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
          <h2 className="text-h3 font-semibold text-foreground">{t('headline')}</h2>
        </div>
        <Reveal>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {METRIC_LABELS.map((labelKey) => (
              <div key={labelKey} className="flex flex-col items-center gap-1 text-center">
                <span
                  className="text-h3 font-semibold tabular-nums text-foreground-disabled"
                  aria-hidden
                >
                  —
                </span>
                <span className="text-body3 text-foreground-secondary">{t(labelKey)}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <p className="mt-6 text-center text-body3 text-foreground-tertiary">{t('caption')}</p>
      </div>
    </section>
  );
}
