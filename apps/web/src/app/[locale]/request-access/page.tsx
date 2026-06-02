import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { RequestAccessClient } from '@/features/access/RequestAccessClient';

export const metadata: Metadata = {
  title: 'BimDossier — Request access',
  description: 'Request a guided demo of BimDossier — Wet kwaliteitsborging voor het bouwen (Wkb)-compliant BIM platform.',
};

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function RequestAccessPage({ params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RequestAccessClient />;
}
