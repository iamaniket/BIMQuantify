import { setRequestLocale } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';

import { AuthLayoutShell } from '@/features/auth/AuthLayoutShell';

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LegalLayout({ children, params }: Props): Promise<JSX.Element> {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AuthLayoutShell formContentMaxWidth="640px" formContentAlign="start" brandSticky>
      <div className="flex flex-col gap-6 py-1">{children}</div>
    </AuthLayoutShell>
  );
}
