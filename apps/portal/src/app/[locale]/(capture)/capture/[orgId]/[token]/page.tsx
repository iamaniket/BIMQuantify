import { setRequestLocale } from 'next-intl/server';
import type { JSX } from 'react';

import { CaptureUploadPage } from '@/features/attachments/CaptureUploadPage';

type Props = {
  params: Promise<{ locale: string; orgId: string; token: string }>;
};

export default async function CapturePage({ params }: Props): Promise<JSX.Element> {
  const { locale, orgId, token } = await params;
  setRequestLocale(locale);

  return <CaptureUploadPage orgId={orgId} token={token} />;
}
