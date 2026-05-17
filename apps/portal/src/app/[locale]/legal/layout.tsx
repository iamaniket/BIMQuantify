import { AuthShell } from '@bimstitch/ui';
import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { AuthHeroBrand } from '@/features/auth/AuthHeroBrand';
import { Link } from '@/i18n/navigation';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  const legalLinks = [
    { href: '/legal/privacy', label: t('navPrivacy') },
    { href: '/legal/terms', label: t('navTerms') },
    { href: '/legal/dpa', label: t('navDpa') },
  ];

  return (
    <AuthShell
      brand={<AuthHeroBrand legalLinks={legalLinks} />}
      topRight={(
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] tracking-[0.02em] text-foreground-tertiary no-underline hover:text-foreground"
        >
          <span aria-hidden>←</span>
          Back to login
        </Link>
      )}
      formContentMaxWidth="640px"
      formContentAlign="start"
      brandSticky
      form={(
        <div className="flex flex-col gap-6 py-1">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            {t('draftBanner')}
          </div>

          {children}
        </div>
      )}
    />
  );
}
