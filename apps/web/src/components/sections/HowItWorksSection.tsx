'use client';

import { ArrowRight, Bell, FileUp, MapPin, Search } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';

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
    <section id="how-it-works" className="bg-surface-low">
      <div className="mx-auto w-full max-w-8xl px-6 py-20">
        <SectionHeading eyebrow={t('eyebrow')} headline={t('headline')} />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stepKeys.map((key, i) => {
            const number = String(i + 1).padStart(2, '0');
            return (
              <Reveal key={key} delay={i * 100} className="relative flex flex-col gap-4">
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
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
