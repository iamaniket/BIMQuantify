'use client';

import { Sparkles } from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button, Spinner } from '@bimstitch/ui';

import { useProjectPermissions } from '@/features/permissions';
import { ApiError } from '@/lib/api/client';
import type { ReportType } from '@/lib/api/schemas/reports';

import { useGenerateReport } from './hooks';
import { REPORT_TYPE_ORDER } from './reportTypeMeta';

/**
 * Four side-by-side generate buttons (one per report type) for the dedicated
 * Reports page toolbar, where there's room for them — Compliance is the primary
 * (filled) action, the other three are secondary. Owns the generate mutation,
 * the permission gate (renders nothing when the user can't create), and the
 * per-type 422 "missing source data" hint (surfaced as a toast). The inline
 * project-detail Reports tab keeps its compact SplitButton.
 */
export function ReportGenerateButtons({
  projectId,
  onGenerated,
}: {
  projectId: string;
  onGenerated?: (reportId: string) => void;
}): JSX.Element | null {
  const t = useTranslations('reports');
  const { can } = useProjectPermissions(projectId);
  const generate = useGenerateReport(projectId);
  const [pendingType, setPendingType] = useState<ReportType | null>(null);

  if (!can('report', 'create')) return null;

  const generateType = (reportType: ReportType): void => {
    setPendingType(reportType);
    generate.mutate(
      { report_type: reportType, locale: null, params: {} },
      {
        onSuccess: (report) => { onGenerated?.(report.id); },
        onError: (error) => {
          // A 422 means the type has no source data yet — surface the hint.
          const message =
            error instanceof ApiError && error.status === 422
              ? t(`types.${reportType}.missingData`)
              : t('shared.errorGenerating');
          toast.error(message);
        },
        onSettled: () => { setPendingType(null); },
      },
    );
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {REPORT_TYPE_ORDER.map((type) => (
        <Button
          key={type}
          variant={type === 'compliance_report' ? 'primary' : 'border'}
          size="md"
          className="shrink-0 whitespace-nowrap"
          disabled={generate.isPending}
          onClick={() => { generateType(type); }}
        >
          {pendingType === type ? (
            <Spinner size="md" className="mr-1.5 h-3 w-3 text-current" />
          ) : (
            <Sparkles className="mr-1.5 h-3 w-3" />
          )}
          {t(`types.${type}.title`)}
        </Button>
      ))}
    </div>
  );
}
