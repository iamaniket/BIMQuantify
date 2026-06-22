'use client';

import { CalendarDays, ChevronDown, ChevronRight, Clock } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';

import type { Deadline, EffectiveDeadlineNotificationSettings } from '@/lib/api/schemas/deadlines';

import { DeadlineRow } from './deadlines/DeadlineRow';
import { FilingDialog } from './deadlines/FilingDialog';
import { useDeadlines, useFileDeadline } from './deadlines/useDeadlines';
import {
  useProjectDeadlineSettings,
} from './deadlines/useDeadlineNotificationSettings';

type Props = {
  projectId: string;
};

// Rendered as its own card on the project-detail page (directly below the
// "Quality & documents" launcher): a collapsible "Deadlines" header + compact
// DeadlineRow items. The card chrome is provided by the caller (RightColumnTabs).
export function DeadlinesSection({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const deadlinesQuery = useDeadlines(projectId);
  const settingsQuery = useProjectDeadlineSettings(projectId);
  const fileMutation = useFileDeadline(projectId);
  const [filingDeadline, setFilingDeadline] = useState<{ deadline: Deadline; label: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const deadlines = deadlinesQuery.data ?? [];
  const settings = settingsQuery.data ?? [];

  const labelMap = new Map<string, EffectiveDeadlineNotificationSettings>();
  for (const s of settings) {
    labelMap.set(s.deadline_type, s);
  }

  if (deadlinesQuery.isLoading) {
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (deadlines.length === 0) {
    return (
      <div className="px-2 py-6 text-center">
        <Clock className="mx-auto mb-2 h-6 w-6 text-foreground-tertiary" />
        <div className="text-body3 font-semibold">{t('deadlines.emptyTitle')}</div>
        <div className="mt-1 text-caption text-foreground-tertiary">
          {t('deadlines.emptyDescription')}
        </div>
      </div>
    );
  }

  const metCount = deadlines.filter((d) => d.status === 'met').length;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setCollapsed((prev) => !prev); }}
          className="flex flex-1 items-center gap-1.5 text-body3 font-semibold text-foreground-secondary hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {t('deadlines.heading')}
          <span className="ml-1 text-caption tabular-nums text-foreground-tertiary">
            {metCount}/{deadlines.length}
          </span>
        </button>
        <Link
          href="/calendar"
          className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-primary hover:underline"
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {t('deadlines.viewOnCalendar')}
        </Link>
      </div>

      {!collapsed && (
        <ul className="space-y-1.5">
          {deadlines.map((dl) => {
            const meta = labelMap.get(dl.deadline_type);
            const dlLabel = meta !== undefined ? meta.label : dl.deadline_type;
            const ref = meta !== undefined ? meta.legal_reference : null;
            return (
              <DeadlineRow
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
        </ul>
      )}

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
    </section>
  );
}
