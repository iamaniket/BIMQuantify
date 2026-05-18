'use client';

import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, EmptyState } from '@bimstitch/ui';

export function BorgingsplanTab(): JSX.Element {
  const t = useTranslations('projectDetail.tabs.borgingsplan');

  return (
    <EmptyState
      icon={ClipboardList}
      title={t('title')}
      description={t('description')}
      action={(
        <Button variant="border" size="sm" disabled aria-disabled="true">
          {t('ctaLabel')}
        </Button>
      )}
      className={undefined}
    />
  );
}
