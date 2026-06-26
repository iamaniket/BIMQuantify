import { getTranslations } from 'next-intl/server';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { HeroPill } from '@/components/sections/HeroPill';
import { HeroShell } from '@/components/sections/HeroShell';

export async function BlogHero({ locale }: { locale: Locale }): Promise<JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'blog' });

  return (
    <HeroShell size="page" className="gap-3">
      <HeroPill>{t('eyebrow')}</HeroPill>
      <h1 className="max-w-2xl text-h3 font-semibold text-white sm:text-h2">{t('headline')}</h1>
      <p className="max-w-xl text-body1 text-white/70">{t('subtitle')}</p>
    </HeroShell>
  );
}
