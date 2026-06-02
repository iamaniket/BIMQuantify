'use client';

import type { JSX } from 'react';

import { getLegalContent } from '@bimstitch/i18n';

import { useLocale } from '@/providers/LocaleProvider';

import { LegalArticle } from '../LegalArticle';

export default function TermsPage(): JSX.Element {
  const { locale } = useLocale();
  const { terms, meta } = getLegalContent(locale);

  return <LegalArticle doc={terms} lastUpdatedLabel={meta.lastUpdatedLabel} />;
}
