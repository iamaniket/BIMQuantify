import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { CtaSection } from '@/components/sections/CtaSection';
import { FeaturesSection } from '@/components/sections/FeaturesSection';
import { FromTheBlogSection } from '@/components/sections/FromTheBlogSection';
import { HeroSection } from '@/components/sections/HeroSection';
import { HomeFaqSection } from '@/components/sections/HomeFaqSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { RoadmapSection } from '@/components/sections/RoadmapSection';
import { SnagShowcaseSection } from '@/components/sections/SnagShowcaseSection';
import { TrustBandSection } from '@/components/sections/TrustBandSection';
import { UseCasesSection } from '@/components/sections/UseCasesSection';

// Refresh at most once per minute so the "From the blog" strip picks up newly
// published API posts without a redeploy (mirrors /blog).
export const revalidate = 60;

type Props = {
  params: Promise<{ locale: string }>;
};

// The homepage is self-canonical per language with hreflang alternates so Google
// treats /nl and /en as translations (x-default → nl, the platform default).
// Canonical lives here, not in the locale layout, so subpages aren't wrongly
// canonicalized to the homepage.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    alternates: {
      canonical: `/${locale}`,
      languages: {
        nl: '/nl',
        en: '/en',
        'x-default': '/nl',
      },
      types: { 'application/rss+xml': '/feed.xml' },
    },
  };
}

export default async function WelcomePage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  // Order leads with the working 3D demo (the "see it on the model" promise),
  // then the workflow, the capability catalog, an honest trust band and an
  // objection-resolving FAQ, before demoting the unbuilt roadmap and closing on
  // the CTA. The blog strip self-hides while the blog is empty.
  return (
    <main>
      <HeroSection />
      <SnagShowcaseSection />
      <UseCasesSection />
      <HowItWorksSection />
      <FeaturesSection />
      <TrustBandSection />
      <HomeFaqSection />
      <RoadmapSection />
      <FromTheBlogSection locale={locale as Locale} />
      <CtaSection />
    </main>
  );
}
