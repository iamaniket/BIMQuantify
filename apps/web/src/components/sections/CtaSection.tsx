'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroGrid } from '@bimstitch/brand';
import { Button } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';

export function CtaSection(): JSX.Element {
  const t = useTranslations('cta');

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]">
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
        <h2 className="text-h3 font-semibold text-white sm:text-h2">
          {t('headline')}
        </h2>
        <p className="max-w-xl text-title3 text-white/80">
          {t('subtitle')}
        </p>
        <Link href="/request-access">
          <Button
            variant="primary"
            size="lg"
            className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
          >
            {t('button')}
          </Button>
        </Link>
      </div>
    </section>
  );
}
