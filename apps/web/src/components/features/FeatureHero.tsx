'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { ArrowLeft } from '@bimstitch/ui/icons';

import { HeroShell } from '@/components/sections/HeroShell';
import { Link } from '@/i18n/navigation';

import { getFeatureContent } from './featureContent';

/**
 * Feature-page hero. Reuses the marketing hero backdrop (brand gradient +
 * blueprint grid + green radial accent) but tightened vertically for a
 * compact, one-page feel. The icon is resolved here from the slug so no
 * component function crosses the server→client boundary. Tagline is the
 * headline; intro doubles as the introduction.
 */
export function FeatureHero({ featureKey }: { featureKey: string }): JSX.Element {
  const t = useTranslations('features');
  const tDetail = useTranslations('featureDetail');
  const Icon = getFeatureContent(featureKey)?.icon;

  return (
    <HeroShell size="page" className="gap-6">
      <Link
        href="/#features"
        className="inline-flex w-fit items-center gap-1.5 text-body3 font-medium text-white/70 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {tDetail('backToFeatures')}
      </Link>

      <div className="flex items-center gap-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/20">
          {Icon ? <Icon className="h-7 w-7" aria-hidden /> : null}
        </div>
        <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
          {t(`${featureKey}.title`)}
        </span>
      </div>

      <h1 className="max-w-3xl text-h3 font-semibold text-white sm:text-h2">
        {t(`${featureKey}.detail.tagline`)}
      </h1>
      <p className="max-w-2xl text-body1 text-white/80">
        {t(`${featureKey}.detail.intro`)}
      </p>
    </HeroShell>
  );
}
