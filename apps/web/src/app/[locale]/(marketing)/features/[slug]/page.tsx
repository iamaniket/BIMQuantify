import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { supportedLocales } from '@bimstitch/i18n';

import { FeatureBody } from '@/components/features/FeatureBody';
import { FeatureHero } from '@/components/features/FeatureHero';
import { FeatureImages } from '@/components/features/FeatureImages';
import { FEATURE_SLUGS, getFeatureContent } from '@/components/features/featureContent';

// The 12 feature slugs are fully known at build time, so anything outside the
// generated set should hard-404 (no on-demand rendering, unlike the blog).
export const dynamicParams = false;

type Params = { locale: string; slug: string };

export function generateStaticParams(): Params[] {
  return supportedLocales.flatMap((locale) =>
    FEATURE_SLUGS.map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (getFeatureContent(slug) === null) {
    return { title: 'Feature not found — BimDossier' };
  }
  const t = await getTranslations({ locale, namespace: 'features' });
  return {
    // The locale layout supplies the `%s — BimDossier` title template, so the
    // bare feature title is enough — avoids a doubled suffix.
    title: t(`${slug}.title`),
    description: t(`${slug}.detail.intro`),
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<Params>;
}): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  if (getFeatureContent(slug) === null) {
    notFound();
  }

  return (
    <main>
      <FeatureHero featureKey={slug} />
      <FeatureBody featureKey={slug} />
      <FeatureImages featureKey={slug} />
    </main>
  );
}
