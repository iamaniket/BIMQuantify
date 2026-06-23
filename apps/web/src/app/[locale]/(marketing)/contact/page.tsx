import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { ContactSalesClient } from './ContactSalesClient';

export const metadata: Metadata = {
  title: 'BimDossier · Contact sales',
  description: 'Book a demo or get in touch with the BimDossier team to discuss pricing and plans.',
};

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ContactPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContactSalesClient />;
}
