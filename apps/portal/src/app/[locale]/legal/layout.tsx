import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/" className="text-foreground-secondary hover:text-foreground">
          {t('backHome')}
        </Link>
        <span className="text-foreground-secondary/50">·</span>
        <Link href="/legal/privacy" className="text-foreground hover:text-primary">
          {t('navPrivacy')}
        </Link>
        <Link href="/legal/terms" className="text-foreground hover:text-primary">
          {t('navTerms')}
        </Link>
        <Link href="/legal/dpa" className="text-foreground hover:text-primary">
          {t('navDpa')}
        </Link>
      </nav>

      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        {t('draftBanner')}
      </div>

      {children}
    </main>
  );
}
