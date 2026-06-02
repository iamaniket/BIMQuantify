import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { getLegalContent, type Locale } from '@bimstitch/i18n';

import { LegalArticle } from '../LegalArticle';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function PrivacyPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  const { privacy, meta } = getLegalContent(locale as Locale);

  return <LegalArticle doc={privacy} lastUpdatedLabel={meta.lastUpdatedLabel} />;
}
