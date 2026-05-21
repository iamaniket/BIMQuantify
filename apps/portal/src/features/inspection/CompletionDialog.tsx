'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { AppDialog } from '@bimstitch/ui';

import type { InspectionSummary } from '@/lib/api/schemas';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  summary: InspectionSummary | null;
  isPending: boolean;
};

export function CompletionDialog({
  open,
  onClose,
  onConfirm,
  summary,
  isPending,
}: Props): JSX.Element {
  const t = useTranslations('inspection.complete');
  const hasFailed = summary !== null && summary.failed > 0;

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t('title')}
      subtitle={hasFailed ? t('someFailed') : t('allPassed')}
      onSave={onConfirm}
      saveLabel={t('confirm')}
      saveDisabled={isPending}
      cancelLabel={t('cancel')}
      width={400}
    >
      {summary !== null && (
        <div className="flex flex-col gap-2 py-2">
          <SummaryRow label={t('passed')} value={summary.passed} tone="success" />
          <SummaryRow label={t('failedLabel')} value={summary.failed} tone="error" />
          <SummaryRow label={t('notApplicable')} value={summary.not_applicable} tone="warning" />
        </div>
      )}
    </AppDialog>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'error' | 'warning';
}): JSX.Element {
  const colors = {
    success: 'text-success',
    error: 'text-error',
    warning: 'text-warning',
  };
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <span className="text-body3 text-foreground">{label}</span>
      <span className={`text-body2 font-semibold tabular-nums ${colors[tone]}`}>{value}</span>
    </div>
  );
}
