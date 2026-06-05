'use client';

import { ClipboardCheck } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, EmptyState } from '@bimstitch/ui';

export function InspectiesTab(): JSX.Element {
  const t = useTranslations('projectDetail.tabs.inspecties');

  return (
    <EmptyState
      icon={ClipboardCheck}
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
