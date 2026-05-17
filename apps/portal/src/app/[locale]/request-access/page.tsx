import { getTranslations } from 'next-intl/server';
import type { JSX } from 'react';

import { RequestAccessPanel } from '@/features/access/RequestAccessPanel';

export default async function RequestAccessPage(): Promise<JSX.Element> {
  const t = await getTranslations('legal');
  return (
    <RequestAccessPanel
      legalLinks={[
        { href: '/legal/privacy', label: t('navPrivacy') },
        { href: '/legal/terms', label: t('navTerms') },
        { href: '/legal/dpa', label: t('navDpa') },
      ]}
    />
  );
}
