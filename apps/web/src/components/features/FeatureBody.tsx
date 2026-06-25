'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Eyebrow } from '@bimdossier/ui';
import { CheckCircle } from '@bimdossier/ui/icons';

import { Reveal } from '@/components/shared/Reveal';

import { useFeatureContent } from './useFeatureContent';

/**
 * Problem + Solution band for a feature page. Two columns on desktop (stacked
 * on mobile) to keep the page compact. "The challenge" frames the problem;
 * "Our approach" lists how the SaaS solves it as a checked bullet list. Copy is
 * read from the per-feature JSON resolved for the active locale.
 */
export function FeatureBody({ featureKey }: { featureKey: string }): JSX.Element | null {
  const tDetail = useTranslations('featureDetail');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { problemTitle, problem, solutionTitle, solution } = content;

  return (
    <div className="mx-auto grid w-full max-w-8xl grid-cols-1 gap-10 px-6 py-12 lg:grid-cols-2">
      <Reveal className="flex flex-col gap-3">
        <Eyebrow as="div" size="sm" tone="tertiary">
          {tDetail('problemHeading')}
        </Eyebrow>
        <h2 className="text-title2 font-semibold text-foreground">{problemTitle}</h2>
        <p className="text-body1 leading-relaxed text-foreground-secondary">{problem}</p>
      </Reveal>

      <Reveal delay={80} className="flex flex-col gap-3">
        <Eyebrow as="div" size="sm" tone="tertiary">
          {tDetail('solutionHeading')}
        </Eyebrow>
        <h2 className="text-title2 font-semibold text-foreground">{solutionTitle}</h2>
        <ul className="flex flex-col gap-3">
          {solution.map((point) => (
            <li key={point} className="flex gap-2.5 text-body1 text-foreground-secondary">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
