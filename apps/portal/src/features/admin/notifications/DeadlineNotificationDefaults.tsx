'use client';

import { Bell } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Skeleton } from '@bimdossier/ui';

import { DeadlineNotificationForm } from '@/features/projects/detail/deadlines/DeadlineNotificationForm';
import {
  useOrgDeadlineSettings,
  useUpdateOrgDeadlineSetting,
} from '@/features/projects/detail/deadlines/useDeadlineNotificationSettings';

export function DeadlineNotificationDefaults(): JSX.Element {
  const t = useTranslations('orgDetail.notificationDefaults');
  const settingsQuery = useOrgDeadlineSettings();
  const updateSetting = useUpdateOrgDeadlineSetting();

  const settings = settingsQuery.data ?? [];

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="rounded-lg border border-error-light bg-error-lighter px-4 py-6 text-center text-body3 text-error">
        {t('loadError')}
      </div>
    );
  }

  if (settings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
        <Bell className="mx-auto mb-2 h-6 w-6 text-foreground-tertiary" />
        <div className="text-body3 font-semibold">{t('emptyTitle')}</div>
        <div className="mt-1 text-caption text-foreground-tertiary">
          {t('emptyDescription')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-body2 font-bold text-foreground">
          {t('title')}
        </div>
        <div className="mt-1 text-body3 text-foreground-tertiary">
          {t('description')}
        </div>
      </div>

      <DeadlineNotificationForm
        settings={settings}
        onUpdate={(deadlineType, body) => {
          updateSetting.mutate({ deadlineType, body });
        }}
        onRevert={undefined}
        isUpdating={updateSetting.isPending}
        showRevert={false}
      />
    </div>
  );
}
