import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { getLegalContent, type Locale } from '@bimdossier/i18n';

import { LegalArticle } from '../LegalArticle';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DpaPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const { dpa, meta } = getLegalContent(locale as Locale);

  return (
    <LegalArticle doc={dpa} lastUpdatedLabel={meta.lastUpdatedLabel} draftBanner={meta.draftBanner} />
  );
}
