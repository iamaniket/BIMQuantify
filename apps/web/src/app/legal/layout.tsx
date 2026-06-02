'use client';

import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { AuthShell } from '@bimstitch/brand';
import { getLegalContent } from '@bimstitch/i18n';

import { MarketingBrandPanel } from '@/components/MarketingBrandPanel';
import { useLocale } from '@/providers/LocaleProvider';

type Props = { children: ReactNode };

export default function LegalLayout({ children }: Props): JSX.Element {
  const { locale, t } = useLocale();
  const legal = getLegalContent(locale);

  return (
    <AuthShell
      brand={<MarketingBrandPanel />}
      topRight={
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary no-underline hover:text-foreground"
        >
          <span aria-hidden>&larr;</span>
          {t.legalBrand.backToSite}
        </Link>
      }
      form={
        <div className="flex flex-col gap-6 py-1">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            {legal.meta.draftBanner}
          </div>
          {children}
        </div>
      }
      formContentMaxWidth="640px"
      formContentAlign="start"
      brandSticky
    />
  );
}
