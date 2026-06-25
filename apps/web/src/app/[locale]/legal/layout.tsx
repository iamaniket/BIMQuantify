import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { AuthShell } from '@bimdossier/brand';

import { MarketingBrandPanel } from '@/components/MarketingBrandPanel';
import { Link } from '@/i18n/navigation';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'legalBrand' });

  return (
    <AuthShell
      brand={<MarketingBrandPanel />}
      topRight={
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary no-underline hover:text-foreground"
        >
          <span aria-hidden>&larr;</span>
          {t('backToSite')}
        </Link>
      }
      form={<div className="flex flex-col gap-6 py-1">{children}</div>}
      formContentMaxWidth="640px"
      formContentAlign="start"
      brandSticky
    />
  );
}
