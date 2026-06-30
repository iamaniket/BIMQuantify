'use client';

import { ShieldCheck } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroShell } from '@/components/sections/HeroShell';

/**
 * Hero for the /security page. Uses the shared `page`-size HeroShell (same
 * backdrop + language-stable height as the feature/blog headers) and leads with
 * the EU-residency claim in a pill. Copy lives in `securityPage.hero.*`.
 *
 * NOTE: the residency line is intentionally generic ("EU infrastructure") with
 * no named provider/region until production hosting is finalised — see the plan.
 */
export function SecurityHero(): JSX.Element {
  const t = useTranslations('securityPage.hero');

  return (
    <HeroShell size="page" align="center" className="gap-5">
      <span className="text-body3 font-semibold uppercase tracking-wide text-[var(--brand-accent)]">
        {t('eyebrow')}
      </span>

      <h1 className="max-w-3xl text-h3 font-semibold text-white sm:text-h2">
        {t('headline')}
      </h1>

      <p className="max-w-2xl text-title3 text-white/80">{t('lead')}</p>

      <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-body3 text-white/85">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        {t('residency')}
      </p>
    </HeroShell>
  );
}
