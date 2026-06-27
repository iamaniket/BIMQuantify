import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { ContactSalesClient } from './ContactSalesClient';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contactPage' });
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
  };
}

export default async function ContactPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContactSalesClient />;
}
