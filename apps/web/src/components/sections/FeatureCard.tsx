'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { ArrowRight, type AppIcon } from '@bimstitch/ui/icons';

import { useFeatureContent } from '@/components/features/useFeatureContent';
import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { Link } from '@/i18n/navigation';

type FeatureCardProps = {
  /** Catalog `key`; doubles as the content slug and the `/features/<slug>` URL. */
  featureKey: string;
  icon: AppIcon;
};

/**
 * Capabilities-grid card — a token-faithful port of the Claude Design
 * "Feature Card" mockup. The whole card is a single link to the feature's
 * detail page, with a visible "Read more →" cue. A white icon tile pops out of
 * the left edge, a faint blueprint grid washes the surface, and on hover the
 * whole card fills with primary blue: title/body/CTA flip to white, the card
 * lifts, the icon scales up, and the grid lines turn faint white. Every class
 * is a theme token, so dark mode flips automatically — no `dark:` overrides.
 * Title + body come from the per-feature JSON resolved for the active locale;
 * "Read more" is shared chrome from the `features.*` message namespace.
 */
export function FeatureCard({ featureKey, icon: Icon }: FeatureCardProps): JSX.Element | null {
  const t = useTranslations('features');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }

  return (
    <Link
      href={`/features/${featureKey}`}
      className="group relative isolate flex h-full min-h-[13rem] flex-col justify-center overflow-visible rounded-2xl border border-border bg-surface-main py-8 pl-14 pr-6 text-foreground shadow-md outline-none transition-all duration-300 ease-out hover:-translate-y-1.5 hover:border-primary-dark hover:bg-primary hover:shadow-xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Blueprint grid — clipped to the rounded card despite the card's
          `overflow-visible` (needed so the icon can pop out). Faint grey
          normally; faint white over the blue fill on hover. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]">
        <BlueprintTexture
          className="opacity-50 transition-opacity duration-300 group-hover:opacity-20"
          toneClassName="text-border group-hover:text-primary-foreground"
        />
      </div>

      {/* Icon tile — pops out of the left edge (−24px = the section's px-6,
          so the first column never clips). White tile, primary glyph. */}
      <span className="absolute -left-6 top-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-foreground text-primary shadow-lg transition-transform duration-300 ease-out group-hover:scale-110">
        <Icon className="h-7 w-7" aria-hidden />
      </span>

      <div className="flex flex-col gap-3">
        <h3 className="text-title2 font-bold text-foreground transition-colors duration-300 group-hover:text-primary-foreground">
          {content.title}
        </h3>
        <p className="text-body2 text-foreground-tertiary transition-colors duration-300 group-hover:text-primary-foreground">
          {content.card}
        </p>

        <span className="mt-1 inline-flex items-center gap-1.5 text-body3 font-semibold text-primary transition-colors duration-300 group-hover:text-primary-foreground">
          {t('readMore')}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}
