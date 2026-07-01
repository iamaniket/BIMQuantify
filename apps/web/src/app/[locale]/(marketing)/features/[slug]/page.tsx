import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { JSX } from 'react';

import { supportedLocales } from '@bimdossier/i18n';

import { FeatureBody } from '@/components/features/FeatureBody';
import { FeatureFaq } from '@/components/features/FeatureFaq';
import { FeatureHero } from '@/components/features/FeatureHero';
import { FeatureHighlights } from '@/components/features/FeatureHighlights';
import { FeatureImages } from '@/components/features/FeatureImages';
import { FeatureRelated } from '@/components/features/FeatureRelated';
import { FEATURE_SLUGS, getFeatureContent } from '@/components/features/featureContent';
import { LAUNCHED } from '@/components/sections/featureCatalog';

// `dynamicParams` must be a static boolean literal — Next parses it at compile
// time, so it can't branch on LAUNCHED. Keep it `true`: pre-launch we generate
// no detail pages (see generateStaticParams) and every `/features/<key>` renders
// on-demand so `FeaturePage` can redirect it to /coming-soon; launched, the known
// slugs are pre-rendered by generateStaticParams and any unknown slug renders
// on-demand then `notFound()`s (still a 404).
export const dynamicParams = true;

type Params = { locale: string; slug: string };

export function generateStaticParams(): Params[] {
  if (!LAUNCHED) {
    return [];
  }
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
  if (!LAUNCHED) {
    // Pre-launch the request is about to be redirected to /coming-soon; skip the
    // per-feature metadata (and don't leak withheld feature copy).
    return {};
  }
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
  if (!LAUNCHED) {
    // Detail pages are withheld until launch. A real feature URL (old links,
    // search results) redirects to the shared placeholder; a genuinely unknown
    // slug is a real 404. Flip `LAUNCHED` to restore the pages below.
    if (FEATURE_SLUGS.includes(slug)) {
      redirect(`/${locale}/coming-soon`);
    }
    notFound();
  }
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
