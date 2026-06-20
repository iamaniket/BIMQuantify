'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import type { JSX } from 'react';

import { Eyebrow } from '@bimstitch/ui';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { Reveal } from '@/components/shared/Reveal';

import { useFeatureContent } from './useFeatureContent';

/**
 * Bottom "See it in action" strip. Until real screenshots land
 * (`hasAssets === false`), it renders styled placeholder tiles — a tinted
 * blueprint backdrop with the feature icon — so the page ships with zero assets
 * and never 404s. When assets are committed, flip `hasAssets` in the feature's
 * JSON and the real image at `images[i]` is rendered instead. Image paths and
 * captions both come from the per-feature JSON resolved for the active locale.
 */
export function FeatureImages({ featureKey }: { featureKey: string }): JSX.Element | null {
  const tDetail = useTranslations('featureDetail');
  const { content } = useFeatureContent(featureKey);
  if (content === null) {
    return null;
  }
  const { icon: Icon, images, imageCaptions, hasAssets } = content;

  return (
    <section className="mx-auto w-full max-w-8xl px-6 py-12">
      <div className="mb-6 flex flex-col gap-2">
        <Eyebrow as="div" size="sm" tone="tertiary">
          {tDetail('imagesHeading')}
        </Eyebrow>
        <p className="text-body3 text-foreground-tertiary">{tDetail('imagesNote')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((src, i) => {
          const caption = imageCaptions[i] ?? '';
          return (
            <Reveal key={src} delay={i * 80} className="h-full">
              <figure className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-low">
                <div className="relative flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-primary-lighter to-surface-low">
                  {hasAssets ? (
                    <Image
                      src={src}
                      alt={caption}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    <>
                      <BlueprintTexture className="opacity-[0.08]" toneClassName="text-primary" />
                      <Icon className="relative h-10 w-10 text-primary opacity-60" aria-hidden />
                    </>
                  )}
                </div>
                <figcaption className="px-4 py-3 text-body3 text-foreground-secondary">
                  {caption}
                </figcaption>
              </figure>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
