'use client';

import { ArrowRight, Bell, FileUp, MapPin, Search } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { Eyebrow } from '@bimstitch/ui';

type StepKey = 'step1' | 'step2' | 'step3' | 'step4';

const stepIcons: Record<StepKey, ReactNode> = {
  step1: <MapPin className="h-5 w-5" aria-hidden />,
  step2: <FileUp className="h-5 w-5" aria-hidden />,
  step3: <Search className="h-5 w-5" aria-hidden />,
  step4: <Bell className="h-5 w-5" aria-hidden />,
};

const stepKeys: StepKey[] = ['step1', 'step2', 'step3', 'step4'];

export function HowItWorksSection(): JSX.Element {
  const t = useTranslations('howItWorks');

  return (
    <section className="bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="mb-12 flex flex-col items-center gap-3 text-center">
          <Eyebrow size="sm">{t('eyebrow')}</Eyebrow>
          <h2 className="max-w-2xl text-h3 font-semibold text-foreground">
            {t('headline')}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stepKeys.map((key, i) => {
            const number = String(i + 1).padStart(2, '0');
            return (
              <div key={key} className="relative flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-body3 font-bold text-primary-foreground">
                    {number}
                  </div>
                  {i < stepKeys.length - 1 && (
                    <ArrowRight className="hidden h-4 w-4 text-foreground-tertiary lg:block" aria-hidden />
                  )}
                </div>
                <div className="flex items-center gap-2 text-primary">
                  {stepIcons[key]}
                  <h3 className="text-title3 font-semibold text-foreground">
                    {t(`${key}.title`)}
                  </h3>
                </div>
                <p className="text-body2 text-foreground-secondary">
                  {t(`${key}.body`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
