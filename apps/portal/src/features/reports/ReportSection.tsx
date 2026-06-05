'use client';

import { Download, ExternalLink, FileText, Sparkles, X } from '@bimstitch/ui/icons';
import { useState, type JSX, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { Report, ReportStatus, ReportType } from '@/lib/api/schemas/reports';

import { useGenerateReport, useReport, useReports } from './hooks';

type Props = {
  projectId: string;
  /** Which report type this section generates / lists. */
  reportType: ReportType;
  /**
   * API error `detail` code that maps to this type's "no source data" hint
   * (e.g. NO_COMPLIANCE_DATA, NO_ASSURANCE_PLAN). Omit if the type can always
   * be generated.
   */
  missingDataDetail?: string;
  /** Extra per-row actions (e.g. the verklaring sign button in #32). */
  renderRowActions?: (report: Report) => ReactNode;
};

const STATUS_TONE: Record<ReportStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'info',
  running: 'warning',
  ready: 'success',
  failed: 'error',
};

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'zojuist';
  if (minutes < 60) return `${String(minutes)}m geleden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}u geleden`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d geleden`;
}

/**
 * One generated-PDF report type: a Generate button, a list of past reports with
 * status pills + download, and an inline preview drawer. Driven entirely by
 * `reportType` + i18n under `reports.types.<type>` and `reports.shared`, so the
 * four report types (compliance / borgingsplan / verklaring / dossier) share a
 * single component.
 */
export function ReportSection({
  projectId,
  reportType,
  missingDataDetail,
  renderRowActions,
}: Props): JSX.Element {
  const t = useTranslations('reports');
  const reportsQuery = useReports(projectId, reportType);
  const generate = useGenerateReport(projectId);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const reports = reportsQuery.data?.items ?? [];

  const handleGenerate = (): void => {
    generate.mutate(
      { report_type: reportType, locale: null, params: {} },
      { onSuccess: (report) => { setPreviewId(report.id); } },
    );
  };

  const showMissingData =
    missingDataDetail !== undefined &&
    generate.error instanceof ApiError &&
    generate.error.status === 422 &&
    generate.error.detail === missingDataDetail;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-body2 font-semibold text-foreground">
            {t(`types.${reportType}.title`)}
          </h3>
          <p className="text-caption text-foreground-tertiary">
            {t(`types.${reportType}.description`)}
          </p>
        </div>
        <Button variant="primary" size="sm" disabled={generate.isPending} onClick={handleGenerate}>
          {generate.isPending ? (
            <Spinner size="sm" className="mr-1.5 h-3 w-3 text-current" />
          ) : (
            <Sparkles className="mr-1.5 h-3 w-3" />
          )}
          {t(`types.${reportType}.generate`)}
        </Button>
      </header>

      {showMissingData ? (
        <div className="rounded-md border border-warning bg-warning-subtle px-3 py-2 text-caption text-warning-foreground">
          {t(`types.${reportType}.missingData`)}
        </div>
      ) : null}

      {reportsQuery.isLoading ? (
        <div className="px-3 py-4 text-center text-caption text-foreground-tertiary">
          {t('shared.loading')}
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
          <FileText className="mx-auto mb-2 h-5 w-5 text-foreground-tertiary" />
          <div className="text-body3 font-medium">{t('shared.noReports')}</div>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              onView={() => { setPreviewId(report.id); }}
              extraActions={renderRowActions?.(report)}
            />
          ))}
        </ul>
      )}

      <ReportPreviewDrawer
        projectId={projectId}
        reportId={previewId}
        onClose={() => { setPreviewId(null); }}
      />
    </section>
  );
}

function ReportRow({
  report,
  onView,
  extraActions,
}: {
  report: Report;
  onView: () => void;
  extraActions?: ReactNode;
}): JSX.Element {
  const t = useTranslations('reports');
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-border px-3 py-2 text-body3">
      <div className="min-w-0">
        <div className="truncate font-semibold text-foreground">{report.title}</div>
        <div className="font-sans text-caption text-foreground-tertiary">
          {formatRelative(report.created_at)}
          {report.status === 'failed' && report.error !== null
            ? ` · ${report.error.slice(0, 80)}`
            : ''}
        </div>
      </div>
      <Badge variant={STATUS_TONE[report.status]} className="capitalize">
        {t(`shared.status.${report.status}`)}
      </Badge>
      <div className="flex gap-1.5">
        {extraActions}
        <Button
          variant="border"
          size="sm"
          disabled={report.status !== 'ready'}
          onClick={onView}
          title={t('shared.view')}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
        {report.download_url !== null ? (
          <a
            href={report.download_url}
            download={`${report.title}.pdf`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-background-hover"
            title={t('shared.download')}
          >
            <Download className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function ReportPreviewDrawer({
  projectId,
  reportId,
  onClose,
}: {
  projectId: string;
  reportId: string | null;
  onClose: () => void;
}): JSX.Element | null {
  const t = useTranslations('reports');
  const reportQuery = useReport(projectId, reportId);

  if (reportId === null) return null;

  const report = reportQuery.data;
  const isPending = report === undefined;
  const isInProgress =
    report !== undefined && (report.status === 'queued' || report.status === 'running');

  return (
    <Dialog open={reportId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>{report?.title ?? t('shared.loading')}</span>
            {report !== undefined ? (
              <Badge variant={STATUS_TONE[report.status]} className="ml-2 capitalize">
                {t(`shared.status.${report.status}`)}
              </Badge>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="min-h-[60vh]">
          {isPending ? (
            <div className="flex h-full min-h-[60vh] items-center justify-center text-caption text-foreground-tertiary">
              <Spinner className="mr-2 h-4 w-4" /> {t('shared.loading')}
            </div>
          ) : isInProgress ? (
            <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 text-caption text-foreground-tertiary">
              <Spinner className="h-6 w-6" />
              <div>{t('shared.generating')}</div>
            </div>
          ) : report.status === 'failed' ? (
            <div className="rounded-md border border-error bg-error-subtle p-3 text-body3 text-error-foreground">
              {t('shared.errorGenerating')}
              {report.error !== null ? (
                <div className="mt-2 font-sans text-caption">{report.error}</div>
              ) : null}
            </div>
          ) : report.download_url !== null ? (
            <iframe
              src={report.download_url}
              title={report.title}
              className="h-[70vh] w-full rounded-md border border-border bg-background"
            />
          ) : (
            <div className="text-caption text-foreground-tertiary">{t('shared.noPreview')}</div>
          )}
        </DialogBody>

        <DialogClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 rounded-md p-1 text-foreground-tertiary transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
