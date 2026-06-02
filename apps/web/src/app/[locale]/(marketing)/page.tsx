import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { CtaSection } from '@/components/sections/CtaSection';
import { FeaturesSection } from '@/components/sections/FeaturesSection';
import { HeroSection } from '@/components/sections/HeroSection';
import { HowItWorksSection } from '@/components/sections/HowItWorksSection';

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
      <HowItWorksSection />
      <CtaSection />
    </main>
  );
}
