'use client';

import {
  Check, Download, ExternalLink, PenLine,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { RowActionPill } from '@/components/shared/resource/RowActionPill';
import { useProjectPermissions } from '@/features/permissions';
import { formatDateTime } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { Report } from '@/lib/api/schemas/reports';

import { useSignReport } from './hooks';
import { REPORT_TYPE_META, STATUS_TONE } from './reportTypeMeta';

/** A report generation annotated with its 1-based version number within its type. */
export type ReportRow = Report & { versionNumber: number };

/**
 * Flat, one-row-per-generation report list — the second tab of the dedicated
 * Reports page. Columns sort client-side (keys match the page's
 * `useClientPagination` accessors); per-row actions (View / Download / Sign)
 * are rendered via {@link RowActionPill}.
 */
export function ReportsTable({
  projectId,
  table,
  onView,
}: {
  projectId: string;
  table: TablePagination<ReportRow>;
  onView: (reportId: string) => void;
}): JSX.Element {
  const t = useTranslations('reports');
  const tHub = useTranslations('reports.hub');
  const tSign = useTranslations('reports.sign');
  const locale = useLocale() as Locale;
  const { can } = useProjectPermissions(projectId);
  const canSign = can('completion_declaration', 'sign');
  const sign = useSignReport(projectId);

  const columns: Column<ReportRow>[] = [
    {
      header: tHub('columns.report'),
      sortKey: 'type',
      className: 'font-sans',
      cell: (r) => {
        const meta = REPORT_TYPE_META[r.report_type];
        const Icon = meta.icon;
        return (
          <div className="flex items-center gap-2.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.tileClass}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body3 font-semibold text-foreground">
                {t(`types.${r.report_type}.title`)}
              </span>
              <span className="block text-caption tabular-nums text-foreground-tertiary">
                v{String(r.versionNumber).padStart(2, '0')}
              </span>
            </span>
          </div>
        );
      },
    },
    {
      header: tHub('columns.status'),
      sortKey: 'status',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <Badge variant={STATUS_TONE[r.status]} size="sm" className="capitalize">
          {t(`shared.status.${r.status}`)}
        </Badge>
      ),
    },
    {
      header: tHub('columns.created'),
      sortKey: 'created_at',
      className: 'whitespace-nowrap text-body3 tabular-nums text-foreground-tertiary',
      cell: (r) => formatDateTime(r.created_at, locale),
    },
    {
      header: tHub('columns.size'),
      sortKey: 'size',
      className: 'whitespace-nowrap text-body3 tabular-nums text-foreground-tertiary',
      cell: (r) => (r.byte_size !== null ? formatFileSize(r.byte_size) : '—'),
    },
    {
      header: tHub('columns.actions'),
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.report_type === 'completion_declaration' && r.signed_at !== null ? (
            <span
              className="inline-flex items-center gap-1 text-caption font-semibold text-success"
              title={r.signature_hash ?? undefined}
            >
              <Check className="h-3 w-3" />
              {tSign('signed')}
            </span>
          ) : r.report_type === 'completion_declaration' && canSign && r.status === 'ready' ? (
            <RowActionPill
              size="sm"
              icon={<PenLine className="h-3 w-3" />}
              label={tSign('sign')}
              title={tSign('sign')}
              pending={sign.isPending}
              disabled={sign.isPending}
              onClick={() => { sign.mutate(r.id); }}
            />
          ) : null}
          <RowActionPill
            size="sm"
            icon={<ExternalLink className="h-3 w-3" />}
            label={t('shared.view')}
            title={t('shared.view')}
            disabled={r.status !== 'ready'}
            onClick={() => { onView(r.id); }}
          />
          {r.download_url !== null ? (
            <RowActionPill
              size="sm"
              icon={<Download className="h-3 w-3" />}
              label={t('shared.download')}
              title={t('shared.download')}
              external={r.download_url}
              download={`${r.title}.pdf`}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(r) => r.id}
      emptyMessage={tHub('list.empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={tHub('list.loadError')}
    />
  );
}
