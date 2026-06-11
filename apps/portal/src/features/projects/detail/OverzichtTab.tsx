'use client';

import { Clock } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import type { Deadline, EffectiveDeadlineNotificationSettings } from '@/lib/api/schemas/deadlines';

import { DeadlineCard } from './deadlines/DeadlineCard';
import { FilingDialog } from './deadlines/FilingDialog';
import { useDeadlines, useFileDeadline } from './deadlines/useDeadlines';
import {
  useProjectDeadlineSettings,
} from './deadlines/useDeadlineNotificationSettings';

type Props = {
  projectId: string;
};

export function OverzichtTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const deadlinesQuery = useDeadlines(projectId);
  const settingsQuery = useProjectDeadlineSettings(projectId);
  const fileMutation = useFileDeadline(projectId);
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
