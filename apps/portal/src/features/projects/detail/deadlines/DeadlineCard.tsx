'use client';

import {
  AlertTriangle,
  Check,
  Clock,
  Minus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button } from '@bimstitch/ui';

import type { Deadline } from '@/lib/api/schemas/deadlines';

type Props = {
  deadline: Deadline;
  label: string;
  legalReference: string | null | undefined;
  canMarkMet: boolean;
  isPending: boolean;
  onMarkMet: () => void;
};

function daysUntil(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function statusIcon(variant: string): typeof Clock {
  if (variant === 'error') return AlertTriangle;
  if (variant === 'success') return Check;
  if (variant === 'default') return Minus;
  return Clock;
}

function iconColor(variant: string): string {
  if (variant === 'error') return 'text-error';
  if (variant === 'warning') return 'text-warning';
  if (variant === 'success') return 'text-success';
  return 'text-foreground-tertiary';
}

function resolveStatus(
  deadline: Deadline,
  daysRemaining: number | null,
  t: ReturnType<typeof useTranslations>,
): { variant: 'default' | 'warning' | 'error' | 'success' | 'info'; label: string } {
  if (deadline.status === 'met') {
    return { variant: 'success', label: t('statuses.met') };
  }
  if (deadline.status === 'not_applicable') {
    return { variant: 'default', label: t('statuses.notApplicable') };
  }
  if (deadline.is_overdue) {
    return { variant: 'error', label: t('statuses.overdue') };
  }
  if (daysRemaining !== null && daysRemaining <= 7) {
    return { variant: 'warning', label: t('statuses.pending') };
  }
  return { variant: 'info', label: t('statuses.pending') };
}

function daysLabel(
  deadline: Deadline,
  daysRemaining: number,
  t: ReturnType<typeof useTranslations>,
): string {
  if (deadline.is_overdue) {
    return t('overdueDays', { days: Math.abs(daysRemaining) });
  }
  return t('daysRemaining', { days: daysRemaining });
}

function daysClassName(deadline: Deadline, daysRemaining: number): string {
  if (deadline.is_overdue) return 'font-semibold text-error';
  if (daysRemaining <= 7) return 'font-semibold text-warning';
  return '';
}

export function DeadlineCard({
  deadline,
  label,
  legalReference,
  canMarkMet,
  isPending,
  onMarkMet,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines');

  const daysRemaining = deadline.due_date !== null
    ? daysUntil(deadline.due_date)
    : null;

  const resolved = resolveStatus(deadline, daysRemaining, t);
  const statusVariant = resolved.variant;
  const statusLabel = resolved.label;

  const Icon = statusIcon(statusVariant);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-secondary">
        <Icon className={`h-4 w-4 ${iconColor(statusVariant)}`} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body3 font-semibold text-foreground">
            {label}
          </span>
          <Badge variant={statusVariant} className="text-caption">
            {statusLabel}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-caption text-foreground-tertiary">
          {deadline.due_date !== null ? (
            <>
              <span>{t('dueDate', { date: deadline.due_date })}</span>
              {deadline.status === 'pending' && daysRemaining !== null && (
                <>
                  <span>·</span>
                  <span className={daysClassName(deadline, daysRemaining)}>
                    {daysLabel(deadline, daysRemaining, t)}
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
              <span className="font-mono">{legalReference}</span>
            </>
          )}
        </div>
      </div>

      {canMarkMet && deadline.status === 'pending' && (
        <Button
          variant="border"
          size="sm"
          disabled={isPending}
          onClick={onMarkMet}
        >
          <Check className="mr-1 h-3 w-3" />
          {t('markMet')}
        </Button>
      )}
    </div>
  );
}
