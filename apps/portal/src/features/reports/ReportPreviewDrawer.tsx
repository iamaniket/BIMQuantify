'use client';

import { FileText, X } from '@bimstitch/ui/icons';
import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@bimstitch/ui';

import { useReport } from './hooks';
import { STATUS_TONE } from './reportTypeMeta';

/**
 * Inline PDF preview for a single generated report. Polls the report (via
 * {@link useReport}) while it is still rendering, then shows the PDF in an
 * iframe. Shared by every report-type card and the Reports tab container.
 */
export function ReportPreviewDrawer({
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
            <div className="rounded-md border border-error bg-error-light p-3 text-body3 text-error-foreground">
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
