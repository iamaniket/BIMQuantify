'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroGrid } from '@bimdossier/brand';
import { Button } from '@bimdossier/ui';

import { Reveal } from '@/components/shared/Reveal';
import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';
import { portalHref } from '@/lib/portalLinks';

import { BrandAccentCta } from './BrandAccentCta';

export function CtaSection(): JSX.Element {
  const t = useTranslations('cta');
  const tHeader = useTranslations('header');
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[var(--brand-gradient-start)] to-[var(--brand-gradient-end)]">
      <HeroGrid opacity={0.08} stroke="#ffffff" step={36} />
      <Reveal className="relative">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
          <h2 className="text-h3 font-semibold text-white sm:text-h2">
            {t('headline')}
          </h2>
          <p className="max-w-xl text-title3 text-white/80">
            {t('subtitle')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Signup CTA is env-gated. Pre-launch it falls back to a soft
                "Get in touch" so the closing band still has a next step. */}
            {env.NEXT_PUBLIC_ENABLE_SIGNUP ? (
              <BrandAccentCta href={portalHref(locale, '/signup')}>{t('button')}</BrandAccentCta>
            ) : (
              <Link href="/contact">
                <Button
                  variant="primary"
                  size="lg"
                  className="bg-[var(--brand-accent)] text-[var(--brand-gradient-start)] hover:bg-[var(--brand-accent-soft)]"
                >
                  {tHeader('getInTouch')}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
