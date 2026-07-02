'use client';

import { FileText, Plus } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MediaRow,
} from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { ReportViewerDialog } from '@/features/reports/ReportViewerDialog';
import { useGenerateReport } from '@/features/reports/hooks';
import { REPORT_TYPE_META, REPORT_TYPE_ORDER, STATUS_TONE } from '@/features/reports/reportTypeMeta';
import { useProjectOverview } from '@/features/projects/useProjectOverview';
import { useProjectPermissions } from '@/features/permissions';
import { ApiError } from '@/lib/api/client';
import type { ReportType } from '@/lib/api/schemas/reports';
import { formatAgo, formatDateTime } from '@/lib/formatting/dates';

import { LauncherPanel } from './LauncherPanel';

const MAX_ROWS = 4;
const ROW_HEIGHT_PX = 34;

export function ReportsLauncherCard({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const tReports = useTranslations('reports');
  const locale = useLocale() as Locale;
  const { can } = useProjectPermissions(projectId);
  // Report preview + count come from the shared project-overview aggregate.
  const overviewQuery = useProjectOverview(projectId);
  const reportsBlock = overviewQuery.data?.reports;
  const generate = useGenerateReport(projectId);

  const [previewId, setPreviewId] = useState<string | null>(null);

  const recent = reportsBlock?.preview.slice(0, MAX_ROWS) ?? [];
  const count = reportsBlock?.count ?? 0;

  const generateType = (reportType: ReportType): void => {
    generate.mutate(
      { report_type: reportType, locale: null, params: {} },
      {
        onError: (error) => {
          // A 422 means the type has no source data yet — surface the per-type hint.
          const message =
            error instanceof ApiError && error.status === 422
              ? tReports(`types.${reportType}.missingData`)
              : tReports('shared.errorGenerating');
          toast.error(message);
        },
      },
    );
  };

  const createAction = can('report', 'create') ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="md" disabled={generate.isPending}>
          <Plus className="h-3.5 w-3.5" />
          {t('nav.new')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {REPORT_TYPE_ORDER.map((type) => {
          const Icon = REPORT_TYPE_META[type].icon;
          return (
            <DropdownMenuItem
              key={type}
              onSelect={() => { generateType(type); }}
            >
              <Icon className="h-4 w-4" />
              {tReports(`types.${type}.title`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <>
      <LauncherPanel
        icon={<FileText className="h-4 w-4" />}
        label={t('rapporten.label')}
        count={count}
        boardHref={`/projects/${projectId}/reports`}
        viewAllLabel={t('nav.viewAll')}
        headerAction={createAction}
        emptyLabel={t('nav.empty')}
        isLoading={overviewQuery.isLoading}
        isEmpty={recent.length === 0}
        rowHeightPx={ROW_HEIGHT_PX}
        maxRows={MAX_ROWS}
      >
        {(visible) => recent.slice(0, visible).map((r) => {
          const Icon = REPORT_TYPE_META[r.report_type].icon;
          const createdSeconds = (Date.now() - new Date(r.created_at).getTime()) / 1000;
          return (
            <MediaRow
              key={r.id}
              className="min-h-[34px] max-h-[48px] flex-1"
              media={<Icon className="h-5 w-5 shrink-0 text-foreground-tertiary" />}
              title={r.title}
              description={tReports(`types.${r.report_type}.title`)}
              // Reports aren't person-owned (only an optional signer), so unlike the
              // certificate / attachment rows there is no uploader avatar column.
              trailing={(
                <div className="flex items-center gap-3 text-caption text-foreground-tertiary">
                  <span
                    className="w-[52px] shrink-0 whitespace-nowrap text-right"
                    title={formatDateTime(r.created_at, locale)}
                  >
                    {formatAgo(createdSeconds, locale)}
                  </span>
                  <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
                  <Badge variant={STATUS_TONE[r.status]} size="sm">
                    {tReports(`shared.status.${r.status}`)}
                  </Badge>
                </div>
              )}
              showChevron
              disabled={r.status !== 'ready'}
              onClick={() => { setPreviewId(r.id); }}
            />
          );
        })}
      </LauncherPanel>

      <ReportViewerDialog
        projectId={projectId}
        reportId={previewId}
        onClose={() => { setPreviewId(null); }}
      />
    </>
  );
}
