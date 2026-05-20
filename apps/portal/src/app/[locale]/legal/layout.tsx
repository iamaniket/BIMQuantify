import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  return (
    <AuthLayoutShell formContentMaxWidth="640px" formContentAlign="start" brandSticky>
      <div className="flex flex-col gap-6 py-1">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {t('draftBanner')}
        </div>

        {children}
      </div>
    </AuthLayoutShell>
  );
}
