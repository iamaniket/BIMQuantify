'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { Reveal } from '@/components/shared/Reveal';

import { getFeatureContent } from './featureContent';

/**
 * Bottom "See it in action" strip. Until real screenshots land
 * (`hasAssets === false`), it renders styled placeholder tiles — a tinted
 * blueprint backdrop with the feature icon — so the page ships with zero assets
 * and never 404s. When assets are committed, flip `hasAssets` in
 * `featureContent.ts` and swap the tile body for a real image. Captions are
 * localized via `features.<key>.detail.images[i].caption`.
 */
export function FeatureImages({ featureKey }: { featureKey: string }): JSX.Element | null {
  const t = useTranslations('features');
  const tDetail = useTranslations('featureDetail');
  const content = getFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { icon: Icon, images } = content;
  const captions = t.raw(`${featureKey}.detail.images`) as Array<{ caption: string }>;

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-12">
      <div className="mb-6 flex flex-col gap-2">
        <Eyebrow as="div" size="sm" tone="tertiary">
          {tDetail('imagesHeading')}
        </Eyebrow>
        <p className="text-body3 text-foreground-tertiary">{tDetail('imagesNote')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((img, i) => (
          <Reveal key={img.file} delay={i * 80} className="h-full">
            <figure className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-low">
              <div className="relative flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-primary-lighter to-surface-low">
                <BlueprintTexture className="opacity-[0.08]" toneClassName="text-primary" />
                <Icon className="relative h-10 w-10 text-primary/60" aria-hidden />
              </div>
              <figcaption className="px-4 py-3 text-body3 text-foreground-secondary">
                {captions[i]?.caption ?? ''}
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
