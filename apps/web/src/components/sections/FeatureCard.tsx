'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { ArrowRight, type AppIcon } from '@bimstitch/ui/icons';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { Link } from '@/i18n/navigation';

type FeatureCardProps = {
  /** Catalog `key`; doubles as the i18n namespace and the `/features/<slug>` URL. */
  featureKey: string;
  icon: AppIcon;
};

/**
 * Capabilities-grid card. The whole card is a single link to the feature's
 * detail page, with a visible "Read more →" cue. Portal-aligned look: a faint
 * blueprint texture, a primary top accent bar, a primary icon tile that fills
 * on hover, and a lift + primary glow on hover. Every class is a theme token,
 * so dark mode flips automatically — no `dark:` overrides.
 */
export function FeatureCard({ featureKey, icon: Icon }: FeatureCardProps): JSX.Element {
  const t = useTranslations('features');

  return (
    <Link
      href={`/features/${featureKey}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-low text-foreground outline-none transition-all duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-xl hover:shadow-primary/15 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden />
      <BlueprintTexture className="opacity-[0.06]" toneClassName="text-primary" />

      <div className="relative flex flex-1 flex-col gap-4 px-5 pb-5 pt-6">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-lighter text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="h-6 w-6" aria-hidden />
        </div>

        <div className="space-y-2">
          <h3 className="text-title3 font-semibold text-foreground transition-colors group-hover:text-primary">
            {t(`${featureKey}.title`)}
          </h3>
          <p className="text-body2 text-foreground-secondary">
            {t(`${featureKey}.body`)}
          </p>
        </div>

        <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-body3 font-semibold text-primary">
          {t('readMore')}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}
