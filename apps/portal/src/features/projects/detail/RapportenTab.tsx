'use client';

import { Check, PenLine } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, Spinner } from '@bimstitch/ui';

import { useProjectPermissions } from '@/features/permissions';
import { ReportSection } from '@/features/reports/ReportSection';
import { useSignReport } from '@/features/reports/hooks';
import type { Report } from '@/lib/api/schemas/reports';

type Props = {
  projectId: string;
};

/**
 * Generated-PDF reports for a project — the filing-ready artifacts an aannemer
 * downloads. One `ReportSection` per report type: compliance, borgingsplan,
 * verklaring (with an inspector-only sign action that locks + re-renders), and
 * the dossier bevoegd gezag bundle filed at gereedmelding.
 */
export function RapportenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('reports.sign');
  const { can } = useProjectPermissions(projectId);
  const canSign = can('completion_declaration', 'sign');
  const sign = useSignReport(projectId);

  const renderVerklaringActions = (report: Report): JSX.Element | null => {
    if (report.signed_at !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 text-caption font-semibold text-success"
          title={report.signature_hash ?? undefined}
        >
          <Check className="h-3 w-3" />
          {t('signed')}
        </span>
      );
    }
    if (!canSign || report.status !== 'ready') return null;
    return (
      <Button
        variant="border"
        size="md"
        disabled={sign.isPending}
        onClick={() => { sign.mutate(report.id); }}
      >
        {sign.isPending ? (
          <Spinner size="md" className="mr-1.5 h-3 w-3 text-current" />
        ) : (
          <PenLine className="mr-1.5 h-3 w-3" />
        )}
        {t('sign')}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ReportSection
        projectId={projectId}
        reportType="compliance_report"
        missingDataDetail="NO_COMPLIANCE_DATA"
      />
      <ReportSection
        projectId={projectId}
        reportType="assurance_plan"
        missingDataDetail="NO_ASSURANCE_PLAN"
      />
      <ReportSection
        projectId={projectId}
        reportType="completion_declaration"
        renderRowActions={renderVerklaringActions}
      />
      <ReportSection projectId={projectId} reportType="dossier" />
    </div>
  );
}
