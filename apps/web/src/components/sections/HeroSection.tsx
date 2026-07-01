'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimdossier/ui';

import { Link } from '@/i18n/navigation';
import { env } from '@/lib/env';
import { portalHref } from '@/lib/portalLinks';

import { BrandAccentCta } from './BrandAccentCta';
import { HeroPill } from './HeroPill';
import { HeroShell } from './HeroShell';

export function HeroSection(): JSX.Element {
  const t = useTranslations('hero');
  const locale = useLocale();
  // The trust line is authored as " · "-separated claims so it can render as a
  // scannable strip of dot-prefixed items (stacks on mobile, inlines from sm up).
  const trustItems = t('trust').split(' · ');

  return (
    <HeroShell size="splash" className="gap-6">
      <HeroPill>{t('badge')}</HeroPill>

      <h1 className="max-w-3xl text-h2 font-semibold text-white sm:text-h1">
        {t('headline')}
      </h1>

      <p className="max-w-2xl text-title3 text-white/80">{t('subtitle')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Signup CTA is env-gated (hidden pre-launch). The demo CTA below
            always shows, so the hero keeps a call to action either way. */}
        {env.NEXT_PUBLIC_ENABLE_SIGNUP ? (
          <BrandAccentCta href={portalHref(locale, '/signup')}>{t('ctaPrimary')}</BrandAccentCta>
        ) : null}
        <Link href="/#showcase">
          <Button
            variant="ghost"
            size="lg"
            className="border border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            {t('ctaDemo')}
          </Button>
        </Link>
      </div>

      <ul className="mt-2 flex flex-col gap-x-5 gap-y-2 text-body3 text-white/70 sm:flex-row sm:flex-wrap sm:items-center">
        {trustItems.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-accent)]"
            />
            {item}
          </li>
        ))}
      </ul>
    </HeroShell>
  );
}
