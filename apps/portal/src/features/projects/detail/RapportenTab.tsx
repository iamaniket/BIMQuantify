'use client';

import { FileText, Sparkles } from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  EmptyState, SplitButton, type SplitButtonItem,
} from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
import { useProjectPermissions } from '@/features/permissions';
import { useGenerateReport, useReports } from '@/features/reports/hooks';
import { ReportPreviewDrawer } from '@/features/reports/ReportPreviewDrawer';
import { ReportTypeCard } from '@/features/reports/ReportTypeCard';
import { REPORT_TYPE_ORDER } from '@/features/reports/reportTypeMeta';
import { ApiError } from '@/lib/api/client';
import type { Report, ReportType } from '@/lib/api/schemas/reports';

type Props = {
  projectId: string;
};

/**
 * Generated-PDF reports for a project, laid out like the Models tab: one
 * collapsible card per report type (Compliance, Assurance plan, Completion
 * declaration, Dossier), each holding that type's generations as versions. A
 * primary split-button generates the common Compliance report (the other three
 * sit in its dropdown — the only way to create the first report of a type, since
 * empty types aren't shown).
 */
export function RapportenTab({ projectId }: Props): JSX.Element {
  const t = useTranslations('reports');
  const { can } = useProjectPermissions(projectId);
  const canGenerate = can('report', 'create');

  const reportsQuery = useReports(projectId);
  const generate = useGenerateReport(projectId);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedType, setExpandedType] = useState<ReportType | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [lastGenerateType, setLastGenerateType] = useState<ReportType | null>(null);

  const allReports = reportsQuery.data?.items ?? [];

  // Group newest-first reports into per-type buckets, keeping the canonical
  // order and only the types that actually have a report.
  const byType = new Map<ReportType, Report[]>();
  for (const report of allReports) {
    const list = byType.get(report.report_type) ?? [];
    list.push(report);
    byType.set(report.report_type, list);
  }
  const buckets = REPORT_TYPE_ORDER
    .filter((type) => byType.has(type))
    .map((type) => ({ type, reports: byType.get(type)! }));

  const generateType = (reportType: ReportType): void => {
    setLastGenerateType(reportType);
    generate.mutate(
      { report_type: reportType, locale: null, params: {} },
      {
        onSuccess: (report) => {
          setExpandedType(reportType);
          setPreviewId(report.id);
        },
      },
    );
  };

  // Compliance is the primary action; the other three live in the dropdown.
  const generateItems: SplitButtonItem[] = REPORT_TYPE_ORDER
    .filter((type) => type !== 'compliance_report')
    .map((type) => ({
      id: type,
      label: t(`types.${type}.generate`),
      icon: <Sparkles className="h-4 w-4" />,
      onSelect: () => { generateType(type); },
    }));

  const generateButton = canGenerate ? (
    <SplitButton
      variant="primary"
      size="md"
      label={t('types.compliance_report.generate')}
      icon={<Sparkles className="h-3.5 w-3.5" />}
      onClick={() => { generateType('compliance_report'); }}
      items={generateItems}
      menuLabel={t('tab.generateMenu')}
      disabled={generate.isPending}
    />
  ) : null;

  // A 422 on generate means the type has no source data yet — surface the hint.
  const missingDataMessage =
    lastGenerateType !== null
    && generate.error instanceof ApiError
    && generate.error.status === 422
      ? t(`types.${lastGenerateType}.missingData`)
      : null;

  const filtered = buckets.filter(({ type }) => {
    if (
      searchQuery !== ''
      && !t(`types.${type}.title`).toLowerCase().includes(searchQuery.toLowerCase())
    ) return false;
    return true;
  });

  const searchActive = searchQuery !== '';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('tab.searchPlaceholder')}
        actions={generateButton}
      />

      {missingDataMessage !== null ? (
        <div className="rounded-md border border-warning bg-warning-light px-3 py-2 text-caption text-warning-foreground">
          {missingDataMessage}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <ResourceList
          isLoading={reportsQuery.isLoading}
          total={buckets.length}
          filteredCount={filtered.length}
          searchActive={searchActive}
          noResultsLabel={t('tab.noResults')}
          empty={(
            <EmptyState
              icon={FileText}
              title={t('tab.emptyTitle')}
              description={t('tab.emptyDescription')}
              action={generateButton ?? undefined}
              className={undefined}
            />
          )}
        >
          {filtered.map(({ type, reports }) => (
            <ReportTypeCard
              key={type}
              projectId={projectId}
              reportType={type}
              reports={reports}
              isOpen={expandedType === type}
              onToggle={() => { setExpandedType(expandedType === type ? null : type); }}
              onView={setPreviewId}
              onGenerated={setPreviewId}
            />
          ))}
        </ResourceList>
      </div>

      <ReportPreviewDrawer
        projectId={projectId}
        reportId={previewId}
        onClose={() => { setPreviewId(null); }}
      />
    </div>
  );
}
