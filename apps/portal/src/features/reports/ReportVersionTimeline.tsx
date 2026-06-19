'use client';

import { Download, ExternalLink } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import type { Report } from '@/lib/api/schemas/reports';
import { formatDate } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';

import { STATUS_TONE } from './reportTypeMeta';

export type ReportVersion = {
  report: Report;
  /** 1-based display version number (oldest = 1, latest = highest). */
  versionNumber: number;
};

type Props = {
  /** Newest-first generations of one report type. */
  versions: ReportVersion[];
  onView: (reportId: string) => void;
  /** Extra per-version actions (e.g. the verklaring sign button / signed badge). */
  renderActions?: (report: Report) => ReactNode;
};

/**
 * Version history for one report type — a vertical spine with a node per
 * generation, the head tagged "latest" (mirrors the Models tab's
 * {@link VersionTimeline}). Unlike that read-only timeline, each node carries a
 * status badge and per-version actions: View (opens the preview when ready),
 * Download, plus any `renderActions` (the verklaring sign control).
 */
export function ReportVersionTimeline({ versions, onView, renderActions }: Props): JSX.Element {
  const t = useTranslations('reports');
  const tVer = useTranslations('common.versions');
  const locale = useLocale() as Locale;

  if (versions.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-border bg-surface-main px-3 py-4 text-center text-body3 text-foreground-tertiary">
        {t('tab.noVersions')}
      </div>
    );
  }

  return (
    <div className="relative mt-1 pl-[22px]">
      {/* spine */}
      <div className="absolute bottom-3 left-[5px] top-[7px] w-[2px] rounded bg-border" />
      <div className="flex flex-col">
        {versions.map(({ report, versionNumber }, i) => {
          const isLatest = i === 0;
          return (
            <div key={report.id} className="relative flex items-start gap-3 py-[7px]">
              {/* node */}
              <span
                className={[
                  'absolute left-[-22px] top-[9px] size-3 rounded-full border-2',
                  isLatest
                    ? 'border-primary bg-primary shadow-[0_0_0_3px_var(--primary-light)]'
                    : 'border-border-hover bg-surface-main',
                ].join(' ')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-sans text-body3 font-bold tabular-nums ${
                      isLatest ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    v{String(versionNumber).padStart(2, '0')}
                  </span>
                  {isLatest && (
                    <span className="rounded-sm bg-primary px-1.5 py-px text-caption font-bold uppercase text-primary-foreground">
                      {tVer('latest')}
                    </span>
                  )}
                  <Badge variant={STATUS_TONE[report.status]} size="sm" className="capitalize">
                    {t(`shared.status.${report.status}`)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-foreground-tertiary tabular-nums">
                  <span className="shrink-0">{formatDate(report.created_at, locale)}</span>
                  {report.byte_size !== null && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{formatFileSize(report.byte_size)}</span>
                    </>
                  )}
                  {report.status === 'failed' && report.error !== null && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="min-w-0 truncate text-error">{report.error.slice(0, 80)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {renderActions?.(report)}
                <button
                  type="button"
                  disabled={report.status !== 'ready'}
                  onClick={() => { onView(report.id); }}
                  title={t('shared.view')}
                  aria-label={t('shared.view')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-main text-foreground-secondary transition-colors hover:bg-background-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                {report.download_url !== null ? (
                  <a
                    href={report.download_url}
                    download={`${report.title}.pdf`}
                    title={t('shared.download')}
                    aria-label={t('shared.download')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-main text-foreground-secondary transition-colors hover:bg-background-hover"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
