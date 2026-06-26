'use client';

import { Check, FileText, PenLine } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import type { Locale } from '@bimdossier/i18n';
import { Badge, Button, Spinner } from '@bimdossier/ui';

import {
  DocumentViewerDialog,
  NoPreview,
  type MetaGroupSpec,
  type MetaRow,
} from '@/components/shared/DocumentViewerDialog';
import { useProjectPermissions } from '@/features/permissions';
import { formatDate, formatDateTime } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';
import type { Report } from '@/lib/api/schemas/reports';

import { useReport, useSignReport } from './hooks';
import { STATUS_TONE } from './reportTypeMeta';

// ─── Media stage ─────────────────────────────────────────────────────

/**
 * Reports differ from certificates / attachments: a report can be opened the
 * moment it's generated, so the media stage also covers the in-progress and
 * failed states before falling through to the inline PDF.
 */
function ReportPreview({
  report,
  loadingLabel,
  generatingLabel,
  errorLabel,
  noPreviewLabel,
}: {
  report: Report | undefined;
  loadingLabel: string;
  generatingLabel: string;
  errorLabel: string;
  noPreviewLabel: string;
}): JSX.Element {
  if (report === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-body3 text-foreground-tertiary">
          <Spinner className="mx-auto mb-2 text-primary" />
          {loadingLabel}
        </div>
      </div>
    );
  }

  if (report.status === 'queued' || report.status === 'running') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-body3 text-foreground-tertiary">
          <Spinner className="mx-auto mb-2 text-primary" />
          {generatingLabel}
        </div>
      </div>
    );
  }

  if (report.status === 'failed') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-error bg-error-light p-3 text-body3 text-error-foreground">
          {errorLabel}
          {report.error !== null ? (
            <div className="mt-2 font-sans text-caption">{report.error}</div>
          ) : null}
        </div>
      </div>
    );
  }

  // The inline-disposition URL renders the PDF in the iframe; download_url would
  // force a save. `#toolbar=0` hides the browser's PDF chrome to match the
  // certificate / attachment viewers.
  const url = report.view_url ?? report.download_url;
  if (url !== null) {
    return (
      <iframe
        src={`${url}#toolbar=0`}
        title={report.title}
        className="h-full w-full border-0"
      />
    );
  }

  return <NoPreview filename={`${report.title}.pdf`} label={noPreviewLabel} icon={FileText} />;
}

// ─── Dialog ──────────────────────────────────────────────────────────

/**
 * Previews a single generated report in the shared {@link DocumentViewerDialog}
 * shell, so it reads identically to the attachment / certificate viewers. Polls
 * the report (via {@link useReport}) while it's still rendering, surfaces the
 * report metadata in the rail, and — for a ready completion declaration — lets
 * the inspector sign it straight from the footer.
 */
export function ReportViewerDialog({
  projectId,
  reportId,
  onClose,
}: {
  projectId: string;
  reportId: string | null;
  onClose: () => void;
}): JSX.Element {
  const t = useTranslations('reports.viewer');
  const tShared = useTranslations('reports.shared');
  const tTypes = useTranslations('reports.types');
  const tSign = useTranslations('reports.sign');
  const locale = useLocale() as Locale;

  const { can } = useProjectPermissions(projectId);
  const canSign = can('completion_declaration', 'sign');
  const sign = useSignReport(projectId);

  const reportQuery = useReport(projectId, reportId);
  const report = reportQuery.data;

  const onOpenChange = (open: boolean): void => {
    if (!open) onClose();
  };

  // ── Metadata rail (only once the report has loaded) ──
  const metaGroups: MetaGroupSpec[] = [];
  if (report !== undefined) {
    const fileRows: MetaRow[] = [
      { label: t('fieldFilename'), value: `${report.title}.pdf`, mono: true },
      {
        label: t('fieldSize'),
        value: report.byte_size !== null ? formatFileSize(report.byte_size) : '—',
        mono: true,
      },
      { label: t('fieldFileType'), value: t('fileTypeValue'), mono: true },
    ];

    const reportRows: MetaRow[] = [
      { label: t('fieldType'), value: tTypes(`${report.report_type}.title`) },
      {
        label: t('fieldStatus'),
        value: (
          <Badge variant={STATUS_TONE[report.status]} size="md" bordered>
            {tShared(`status.${report.status}`)}
          </Badge>
        ),
      },
      { label: t('fieldLocale'), value: report.locale.toUpperCase(), mono: true },
    ];
    if (report.report_type === 'completion_declaration' && report.signed_at !== null) {
      reportRows.push({
        label: t('fieldSignedOn'),
        value: formatDate(report.signed_at, locale),
        mono: true,
      });
    }

    const originRows: MetaRow[] = [
      { label: t('fieldCreated'), value: formatDateTime(report.created_at, locale), mono: true },
    ];
    if (report.finished_at !== null) {
      originRows.push({
        label: t('fieldFinished'),
        value: formatDateTime(report.finished_at, locale),
        mono: true,
      });
    }

    metaGroups.push(
      { title: t('groupFile'), rows: fileRows },
      { title: t('groupReport'), rows: reportRows },
      { title: t('groupOrigin'), rows: originRows },
    );
  }

  // ── Footer Sign action (completion declaration only) ──
  let footerActions: ReactNode;
  if (report?.report_type === 'completion_declaration') {
    if (report.signed_at !== null) {
      footerActions = (
        <span
          className="inline-flex items-center gap-1 text-caption font-semibold text-success"
          title={report.signature_hash ?? undefined}
        >
          <Check className="h-3.5 w-3.5" />
          {tSign('signed')}
        </span>
      );
    } else if (canSign && report.status === 'ready') {
      footerActions = (
        <Button
          type="button"
          variant="border"
          size="md"
          disabled={sign.isPending}
          onClick={() => { sign.mutate(report.id); }}
        >
          {sign.isPending ? (
            <Spinner size="md" className="mr-1.5 h-3.5 w-3.5 text-current" />
          ) : (
            <PenLine className="mr-1.5 h-3.5 w-3.5" />
          )}
          {tSign('sign')}
        </Button>
      );
    }
  }

  const downloadUrl =
    report !== undefined && report.download_url !== null && report.download_url !== ''
      ? report.download_url
      : null;

  return (
    <DocumentViewerDialog
      open={reportId !== null}
      onOpenChange={onOpenChange}
      title={t('title')}
      subtitle={t('subtitle')}
      preview={(
        <ReportPreview
          report={report}
          loadingLabel={tShared('loading')}
          generatingLabel={tShared('generating')}
          errorLabel={tShared('errorGenerating')}
          noPreviewLabel={tShared('noPreview')}
        />
      )}
      metaGroups={metaGroups}
      footerInfo={report !== undefined ? formatDateTime(report.created_at, locale) : ''}
      footerActions={footerActions}
      closeLabel={t('close')}
      downloadLabel={downloadUrl !== null ? tShared('download') : undefined}
      onDownload={downloadUrl !== null
        ? () => { window.open(downloadUrl, '_blank'); }
        : undefined}
    />
  );
}
