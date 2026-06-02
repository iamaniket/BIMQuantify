'use client';

import type { JSX } from 'react';

import { getLegalContent } from '@bimstitch/i18n';

import { useLocale } from '@/providers/LocaleProvider';

import { LegalArticle } from '../LegalArticle';

export default function DpaPage(): JSX.Element {
  const { locale } = useLocale();
  const { dpa, meta } = getLegalContent(locale);

  return <LegalArticle doc={dpa} lastUpdatedLabel={meta.lastUpdatedLabel} />;
}
