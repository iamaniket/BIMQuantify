'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Link } from '@/i18n/navigation';

// Slim footer placed below the dashboard content so legal documents are
// always one click away. Required for the Wkb compliance posture: the DPA
// in particular is something B2B buyers will ask for during procurement.
export function DashboardFooter(): JSX.Element {
  const t = useTranslations('dashboardFooter');
  const year = new Date().getFullYear();

  return (
    <footer
      data-testid="dashboard-footer"
      className="shrink-0 border-t border-border bg-background px-6 py-2 text-caption text-foreground-tertiary"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{t('copyright', { year })}</span>
        <nav aria-label="Legal" className="flex items-center gap-4">
          <Link href="/legal/privacy" className="hover:text-foreground">
            {t('privacy')}
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            {t('terms')}
          </Link>
          <Link href="/legal/dpa" className="hover:text-foreground">
            {t('dpa')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
