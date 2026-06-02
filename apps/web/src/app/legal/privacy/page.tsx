'use client';

import type { JSX } from 'react';

import { getLegalContent } from '@bimstitch/i18n';

import { useLocale } from '@/providers/LocaleProvider';

import { LegalArticle } from '../LegalArticle';

export default function PrivacyPage(): JSX.Element {
  const { locale } = useLocale();
  const { privacy, meta } = getLegalContent(locale);

  return <LegalArticle doc={privacy} lastUpdatedLabel={meta.lastUpdatedLabel} />;
}
