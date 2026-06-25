import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { getLegalContent, type Locale } from '@bimdossier/i18n';

import { LegalArticle } from '../LegalArticle';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function TermsPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const { terms, meta } = getLegalContent(locale as Locale);

  return (
    <LegalArticle doc={terms} lastUpdatedLabel={meta.lastUpdatedLabel} draftBanner={meta.draftBanner} />
  );
}
