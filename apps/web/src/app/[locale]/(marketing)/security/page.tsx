import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { CtaSection } from '@/components/sections/CtaSection';
import { SecurityComplianceSection } from '@/components/sections/security/SecurityComplianceSection';
import { SecurityControlsSection } from '@/components/sections/security/SecurityControlsSection';
import { SecurityDisclosureSection } from '@/components/sections/security/SecurityDisclosureSection';
import { SecurityHero } from '@/components/sections/security/SecurityHero';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'securityPage' });
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
  };
}

export default async function SecurityPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  // Surfaces the real, code-verified security posture (controls grid), the
  // EU/Dutch compliance story (residency, GDPR/AVG, DPA, Wkb retention, 72h
  // breach), and a responsible-disclosure channel, before the shared CTA.
  return (
    <main>
      <SecurityHero />
      <SecurityControlsSection />
      <SecurityComplianceSection />
      <SecurityDisclosureSection />
      <CtaSection />
    </main>
  );
}
