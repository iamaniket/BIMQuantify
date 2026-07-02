'use client';

import { AlertTriangle, Check, Clock, FileText, Minus } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { formatDate } from '@/lib/formatting/dates';
import type { Deadline } from '@/lib/api/schemas/deadlines';

type Props = {
  deadline: Deadline;
  label: string;
  legalReference: string | null | undefined;
  canMarkMet: boolean;
  isPending: boolean;
  onMarkMet: () => void;
  onFile?: () => void;
};

type Status = 'met' | 'overdue' | 'soon' | 'pending' | 'na';

function daysUntil(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isFilingType(deadlineType: string): boolean {
  return deadlineType === 'construction_notification'
    || deadlineType === 'completion_notification';
}

function resolveStatus(deadline: Deadline, daysRemaining: number | null): Status {
  if (deadline.status === 'met') return 'met';
  if (deadline.status === 'not_applicable') return 'na';
  if (deadline.is_overdue) return 'overdue';
  if (daysRemaining !== null && daysRemaining <= 7) return 'soon';
  return 'pending';
}

const STATUS_ICON: Record<Status, typeof Clock> = {
  met: Check,
  overdue: AlertTriangle,
  soon: Clock,
  pending: Clock,
  na: Minus,
};

// Pill tint per status — text-color tokens (work without the /opacity modifier).
const STATUS_PILL_COLOR: Record<Status, string> = {
  met: 'text-success',
  overdue: 'text-error',
  soon: 'text-warning',
  pending: 'text-foreground-tertiary',
  na: 'text-foreground-tertiary',
};

const STATUS_KEY: Record<Status, string> = {
  met: 'statuses.met',
  overdue: 'statuses.overdue',
  soon: 'statuses.pending',
  pending: 'statuses.pending',
  na: 'statuses.notApplicable',
};

// Compact row mirroring DossierRow in DossierChecklistTab so deadlines and
// dossier requirements share one look inside the Readiness tab.
export function DeadlineRow({
  deadline,
  label,
  legalReference,
  canMarkMet,
  isPending,
  onMarkMet,
  onFile,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines');
  const locale = useLocale() as Locale;

  const daysRemaining = deadline.due_date !== null ? daysUntil(deadline.due_date) : null;
  const status = resolveStatus(deadline, daysRemaining);
  const Icon = STATUS_ICON[status];
  const showFilingButton = isFilingType(deadline.deadline_type) && onFile !== undefined;

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2">
      <Icon className={`h-5 w-5 shrink-0 ${STATUS_PILL_COLOR[status]}`} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body3 font-medium text-foreground">{label}</span>
          <span
            className={`rounded-full bg-background-secondary px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL_COLOR[status]}`}
          >
            {t(STATUS_KEY[status])}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-caption text-foreground-tertiary">
          {deadline.due_date !== null ? (
            <>
              <span>{t('dueDate', { date: deadline.due_date })}</span>
              {deadline.status === 'pending' && daysRemaining !== null && (
                <>
                  <span>·</span>
                  <span
                    className={
                      deadline.is_overdue
                        ? 'font-semibold text-error'
                        : daysRemaining <= 7
                          ? 'font-semibold text-warning'
                          : ''
                    }
                  >
                    {deadline.is_overdue
                      ? t('overdueDays', { days: Math.abs(daysRemaining) })
                      : t('daysRemaining', { days: daysRemaining })}
                  </span>
                </>
              )}
            </>
          ) : (
            <span>{t('noDueDate')}</span>
          )}
          {legalReference != null && (
            <>
              <span>·</span>
              <span>{legalReference}</span>
            </>
          )}
          {deadline.status === 'met' && deadline.reference_number != null && (
            <>
              <span>·</span>
              <span>{t('filing.referenceShort', { number: deadline.reference_number })}</span>
            </>
          )}
          {deadline.status === 'met' && deadline.filed_at != null && (
            <>
              <span>·</span>
              <span>{t('filing.filedOn', { date: formatDate(deadline.filed_at, locale) })}</span>
            </>
          )}
        </div>
      </div>

      {deadline.status === 'pending' && showFilingButton && (
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          disabled={isPending}
          onClick={onFile}
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          {t('filing.fileButton')}
        </Button>
      )}
      {deadline.status === 'pending' && !showFilingButton && canMarkMet && (
        <Button
          variant="primary"
          size="md"
          className="shrink-0"
          disabled={isPending}
          onClick={onMarkMet}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          {t('markMet')}
        </Button>
      )}
    </li>
  );
}
