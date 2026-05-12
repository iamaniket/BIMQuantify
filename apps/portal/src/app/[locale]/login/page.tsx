import { getTranslations } from 'next-intl/server';
import type { JSX } from 'react';

import { LoginPanel } from '@/features/auth/LoginPanel';

export default async function LoginPage(): Promise<JSX.Element> {
  const t = await getTranslations('legal');
  return (
    <LoginPanel
      legalLinks={[
        { href: '/legal/privacy', label: t('navPrivacy') },
        { href: '/legal/terms', label: t('navTerms') },
        { href: '/legal/dpa', label: t('navDpa') },
      ]}
    />
  );
}
