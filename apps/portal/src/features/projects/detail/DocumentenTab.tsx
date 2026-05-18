'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, EmptyState } from '@bimstitch/ui';

export function DocumentenTab(): JSX.Element {
  const t = useTranslations('projectDetail.tabs.documenten');

  return (
    <EmptyState
      icon={FileText}
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
