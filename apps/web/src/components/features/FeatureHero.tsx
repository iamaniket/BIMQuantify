'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { ArrowLeft } from '@bimdossier/ui/icons';

import { HeroShell } from '@/components/sections/HeroShell';
import { Link } from '@/i18n/navigation';

import { useFeatureContent } from './useFeatureContent';

/**
 * Feature-page hero. Reuses the marketing hero backdrop (brand gradient +
 * blueprint grid + green radial accent) but tightened vertically for a
 * compact, one-page feel. All copy comes from the per-feature JSON resolved for
 * the active locale; the icon is resolved here from the slug so no component
 * function crosses the server→client boundary. Tagline is the headline; intro
 * doubles as the introduction.
 */
export function FeatureHero({ featureKey }: { featureKey: string }): JSX.Element | null {
  const tDetail = useTranslations('featureDetail');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { icon: Icon, title, tagline, intro } = content;

  return (
    <HeroShell size="page" className="gap-6">
      <Link
        href="/#features"
        className="inline-flex w-fit items-center gap-1.5 text-body3 font-medium text-white/70 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {tDetail('backToFeatures')}
      </Link>

      <div className="flex items-center gap-3">
        <Icon className="h-9 w-9 text-white" aria-hidden />
        <span className="text-h5 font-semibold text-white sm:text-h4">{title}</span>
      </div>

      <h1 className="max-w-3xl text-h3 font-semibold text-white sm:text-h2">{tagline}</h1>
      <p className="max-w-2xl text-body1 text-white/80">{intro}</p>
    </HeroShell>
  );
}
