'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, EmptyState } from '@bimstitch/ui';

export function BevindingenTab(): JSX.Element {
  const t = useTranslations('projectDetail.tabs.bevindingen');

  return (
    <EmptyState
      icon={AlertTriangle}
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
