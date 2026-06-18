import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { CtaSection } from '@/components/sections/CtaSection';
import { FeaturesSection } from '@/components/sections/FeaturesSection';
import { FromTheBlogSection } from '@/components/sections/FromTheBlogSection';
import { HeroSection } from '@/components/sections/HeroSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';
import { MetricsSection } from '@/components/sections/MetricsSection';
import { SnagShowcaseSection } from '@/components/sections/SnagShowcaseSection';

// Refresh at most once per minute so the "From the blog" strip picks up newly
// published API posts without a redeploy (mirrors /blog).
export const revalidate = 60;

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function WelcomePage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <HeroSection />
      <FeaturesSection />
      <SnagShowcaseSection />
      <HowItWorksSection />
      <MetricsSection />
      <FromTheBlogSection locale={locale as Locale} />
      <CtaSection />
    </main>
  );
}
