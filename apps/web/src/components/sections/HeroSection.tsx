'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';

import { HeroShell } from './HeroShell';

export function HeroSection(): JSX.Element {
  const t = useTranslations('hero');

  return (
    <HeroShell size="splash" className="gap-6">
      <span className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-body3 font-medium text-white/90">
        {t('badge')}
      </span>

      <h1 className="max-w-3xl text-h2 font-semibold text-white sm:text-h1">
        {t('headline')}
      </h1>

      <p className="max-w-2xl text-title3 text-white/80">{t('subtitle')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/request-access">
          <Button
            variant="primary"
            size="lg"
            className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
          >
            {t('ctaPrimary')}
          </Button>
        </Link>
      </div>
    </HeroShell>
  );
}
