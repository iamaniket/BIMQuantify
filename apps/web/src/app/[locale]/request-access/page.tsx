import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { RequestAccessClient } from '@/features/access/RequestAccessClient';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'requestAccessPage' });
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
  };
}

export default async function RequestAccessPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RequestAccessClient />;
}
