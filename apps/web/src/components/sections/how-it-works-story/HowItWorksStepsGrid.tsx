'use client';

import { ArrowRight, Bell, Box, FileText, FileUp, MapPin, Search } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { Reveal } from '@/components/shared/Reveal';

import type { StoryStepKey } from './storySteps';

/**
 * Icon per step — shared between this fallback grid and the story section's
 * scrolling panels, so both renderings of the six steps stay in sync.
 */
export const STEP_ICONS: Record<StoryStepKey, ReactNode> = {
  step1: <MapPin className="h-5 w-5" aria-hidden />,
  step2: <Box className="h-5 w-5" aria-hidden />,
  step3: <Search className="h-5 w-5" aria-hidden />,
  step4: <FileUp className="h-5 w-5" aria-hidden />,
  step5: <FileText className="h-5 w-5" aria-hidden />,
  step6: <Bell className="h-5 w-5" aria-hidden />,
};

const stepKeys: StoryStepKey[] = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];

/**
 * The six-step grid, extracted verbatim from the old HowItWorksSection body.
 * Serves as the scroll story's no-WebGL / load-failure fallback — nothing
 * changes visually for visitors whose browser can't run the 3D story.
 */
export function HowItWorksStepsGrid(): JSX.Element {
  const t = useTranslations('howItWorks');

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {stepKeys.map((key, i) => {
        const number = String(i + 1).padStart(2, '0');
        return (
          <Reveal key={key} delay={i * 100} className="relative flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-body3 font-bold text-primary-foreground">
                {number}
              </div>
              {i < stepKeys.length - 1 && (i + 1) % 3 !== 0 && (
                <ArrowRight className="hidden h-4 w-4 text-foreground-tertiary lg:block" aria-hidden />
              )}
            </div>
            <div className="flex items-center gap-2 text-primary">
              {STEP_ICONS[key]}
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
  );
}
