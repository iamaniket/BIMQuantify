'use client';

import { ChevronDown, ChevronRight, Clock } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import type { Deadline, EffectiveDeadlineNotificationSettings } from '@/lib/api/schemas/deadlines';

import { DeadlineCard } from './deadlines/DeadlineCard';
import { DeadlineNotificationForm } from './deadlines/DeadlineNotificationForm';
import { FilingDialog } from './deadlines/FilingDialog';
import { useDeadlines, useFileDeadline } from './deadlines/useDeadlines';
import {
  useDeleteProjectDeadlineSetting,
  useProjectDeadlineSettings,
  useUpsertProjectDeadlineSetting,
} from './deadlines/useDeadlineNotificationSettings';

type Props = {
  projectId: string;
  country: string;
};

export function OverzichtTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const tDl = useTranslations('projectDetail.tabs.deadlines');
  const deadlinesQuery = useDeadlines(projectId);
  const settingsQuery = useProjectDeadlineSettings(projectId);
  const fileMutation = useFileDeadline(projectId);
  const upsertSetting = useUpsertProjectDeadlineSetting(projectId);
  const deleteSetting = useDeleteProjectDeadlineSetting(projectId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filingDeadline, setFilingDeadline] = useState<{ deadline: Deadline; label: string } | null>(null);

  const deadlines = deadlinesQuery.data ?? [];
  const settings = settingsQuery.data ?? [];

  const labelMap = new Map<string, EffectiveDeadlineNotificationSettings>();
  for (const s of settings) {
    labelMap.set(s.deadline_type, s);
  }

  return (
    <div className="space-y-5">
      {/* Deadlines section */}
      <section>
        <h3 className="mb-3 text-body3 font-semibold text-foreground">
          {t('overzicht.deadlinesHeading')}
        </h3>

        {deadlinesQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : deadlines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center">
            <Clock className="mx-auto mb-2 h-6 w-6 text-foreground-tertiary" />
            <div className="text-body3 font-semibold">{t('overzicht.emptyTitle')}</div>
            <div className="mt-1 text-caption text-foreground-tertiary">
              {t('overzicht.emptyDescription')}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {deadlines.map((dl) => {
              const meta = labelMap.get(dl.deadline_type);
              const dlLabel = meta !== undefined ? meta.label : dl.deadline_type;
              const ref = meta !== undefined ? meta.legal_reference : null;
              return (
                <DeadlineCard
                  key={dl.id}
                  deadline={dl}
                  label={dlLabel}
                  legalReference={ref}
                  canMarkMet={dl.status === 'pending'}
                  isPending={fileMutation.isPending}
                  onMarkMet={() => { fileMutation.mutate({ deadlineId: dl.id }); }}
                  onFile={() => { setFilingDeadline({ deadline: dl, label: dlLabel }); }}
                />
              );
            })}

            {/* Collapsible notification settings */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => { setSettingsOpen((v) => !v); }}
                className="flex w-full items-center gap-1.5 text-body3 font-semibold text-foreground-secondary hover:text-foreground"
              >
                {settingsOpen
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />}
                {tDl('notificationSettingsToggle')}
              </button>

              {settingsOpen && (
                <div className="mt-3">
                  {settingsQuery.isLoading ? (
                    <Skeleton className="h-32 w-full" />
                  ) : (
                    <DeadlineNotificationForm
                      settings={settings}
                      onUpdate={(deadlineType, body) => {
                        upsertSetting.mutate({ deadlineType, body });
                      }}
                      onRevert={(deadlineType) => {
                        deleteSetting.mutate({ deadlineType });
                      }}
                      isUpdating={
                        upsertSetting.isPending || deleteSetting.isPending
                      }
                      showRevert
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {filingDeadline !== null && (
        <FilingDialog
          open
          onOpenChange={(open) => {
            if (!open) setFilingDeadline(null);
          }}
          projectId={projectId}
          deadline={filingDeadline.deadline}
          label={filingDeadline.label}
        />
      )}
    </div>
  );
}
