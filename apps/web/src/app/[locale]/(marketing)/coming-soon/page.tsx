import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { HeroShell } from '@/components/sections/HeroShell';
import { Link } from '@/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'comingSoon' });
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
  };
}

/**
 * Placeholder destination for portal-bound CTAs (Start for free, Log in, Request
 * access, legal links) while the marketing site runs standalone with no portal /
 * API. Reached only when `NEXT_PUBLIC_STANDALONE=true` reroutes those links here
 * (see `lib/portalLinks.ts` + the `redirects()` in `next.config.mjs`). Uses the
 * shared brand hero so it reads as part of the site, not a dead end.
 */
export default async function ComingSoonPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'comingSoon' });

  return (
    <main>
      <HeroShell size="page" align="center" className="gap-5">
        <span className="text-body3 font-semibold uppercase tracking-wide text-[var(--brand-accent)]">
          {t('eyebrow')}
        </span>

        <h1 className="max-w-3xl text-h3 font-semibold text-white sm:text-h2">
          {t('headline')}
        </h1>

        <p className="max-w-2xl text-title3 text-white/80">{t('subtitle')}</p>

        <Link
          href="/"
          className="mt-2 inline-flex items-center rounded-full bg-white px-5 py-2.5 text-body2 font-semibold text-[var(--brand-gradient-start)] transition-colors hover:bg-white/90"
        >
          {t('backHome')}
        </Link>
      </HeroShell>
    </main>
  );
}
