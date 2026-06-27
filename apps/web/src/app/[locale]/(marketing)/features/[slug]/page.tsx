import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { supportedLocales } from '@bimdossier/i18n';

import { FeatureBody } from '@/components/features/FeatureBody';
import { FeatureFaq } from '@/components/features/FeatureFaq';
import { FeatureHero } from '@/components/features/FeatureHero';
import { FeatureHighlights } from '@/components/features/FeatureHighlights';
import { FeatureImages } from '@/components/features/FeatureImages';
import { FeatureRelated } from '@/components/features/FeatureRelated';
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
  const content = getFeatureContent(slug, locale);
  if (content === null) {
    const t = await getTranslations({ locale, namespace: 'featureDetail' });
    return { title: t('metadata.featureNotFound') };
  }
  const { title, intro: description, keywords } = content;

  return {
    // The locale layout supplies the `%s · BimDossier` title template, so the
    // bare feature title is enough, which avoids a doubled suffix.
    title,
    description,
    keywords,
    openGraph: {
      title: `${title} · BimDossier`,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · BimDossier`,
      description,
    },
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<Params>;
}): Promise<JSX.Element> {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const content = getFeatureContent(slug, locale);
  if (content === null) {
    notFound();
  }

  // Build the FAQPage structured data server-side so it ships in the SSR HTML
  // (Google rich-result eligible). Same pattern as the blog post page.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FeatureHero featureKey={slug} />
      <FeatureBody featureKey={slug} />
      <FeatureHighlights featureKey={slug} />
      <FeatureFaq featureKey={slug} />
      <FeatureImages featureKey={slug} />
      <FeatureRelated featureKey={slug} />
    </main>
  );
}
