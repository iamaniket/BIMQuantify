'use client';

import {
  Check, Download, ExternalLink, PenLine, Sparkles,
} from '@bimstitch/ui/icons';
import { useState, type JSX, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';
import {
  Badge,
  Button,
  CountChip,
  DetailCard,
  DetailCardBody,
  DetailCardRow,
  Eyebrow,
  Select,
  Spinner,
} from '@bimstitch/ui';

import { useProjectPermissions } from '@/features/permissions';
import { useReportTemplates } from '@/features/reportTemplates/hooks';
import type { Report, ReportType } from '@/lib/api/schemas/reports';
import { formatFileSize } from '@/lib/formatting/files';
import { RowActionPill } from '@/components/shared/resource/RowActionPill';

import { useGenerateReport, useSignReport } from './hooks';
import { ReportVersionTimeline, type ReportVersion } from './ReportVersionTimeline';
import { REPORT_TYPE_META, STATUS_TONE } from './reportTypeMeta';

type Props = {
  projectId: string;
  reportType: ReportType;
  /** Newest-first generations of this type (non-empty — empty types aren't rendered). */
  reports: Report[];
  isOpen: boolean;
  onToggle: () => void;
  onView: (reportId: string) => void;
  onGenerated: (reportId: string) => void;
};

function useRelativeTime(): (iso: string) => string {
  const t = useTranslations('reports.tab');
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return t('justNow');
    if (minutes < 60) return t('minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('daysAgo', { count: days });
  };
}

/**
 * One report type as a collapsible card mirroring the Models tab: a media tile +
 * title + latest-status badge collapsed, expanding to a template picker, a
 * "generate new version" action, and the {@link ReportVersionTimeline} of every
 * generation. Repeated generations of this type are its versions.
 */
export function ReportTypeCard({
  projectId,
  reportType,
  reports,
  isOpen,
  onToggle,
  onView,
  onGenerated,
}: Props): JSX.Element {
  const t = useTranslations('reports');
  const tSign = useTranslations('reports.sign');
  const locale = useLocale() as Locale;
  const relative = useRelativeTime();
  const { can } = useProjectPermissions(projectId);
  const canGenerate = can('report', 'create');
  const canSign = can('completion_declaration', 'sign');

  const generate = useGenerateReport(projectId);
  const sign = useSignReport(projectId);
  const templatesQuery = useReportTemplates(reportType);
  const [templateOverride, setTemplateOverride] = useState<string | undefined>(undefined);

  const meta = REPORT_TYPE_META[reportType];
  const Icon = meta.icon;
  const latest = reports[0]!;
  const templates = templatesQuery.data ?? [];
  const defaultTemplate = templates.find((tpl) => tpl.is_default);
  const selectedTemplateId = templateOverride ?? defaultTemplate?.id ?? '';

  // Newest-first → version number counts up from the oldest (1) to the latest (N).
  const versions: ReportVersion[] = reports.map((report, i) => ({
    report,
    versionNumber: reports.length - i,
  }));

  const handleGenerate = (): void => {
    generate.mutate(
      {
        report_type: reportType,
        locale: null,
        template_id: selectedTemplateId === '' ? null : selectedTemplateId,
        params: {},
      },
      { onSuccess: (report) => { onGenerated(report.id); } },
    );
  };

  // The verklaring carries an inspector-only sign action per version.
  const renderVersionActions =
    reportType === 'completion_declaration'
      ? (report: Report): ReactNode => {
          if (report.signed_at !== null) {
            return (
              <span
                className="inline-flex items-center gap-1 text-caption font-semibold text-success"
                title={report.signature_hash ?? undefined}
              >
                <Check className="h-3 w-3" />
                {tSign('signed')}
              </span>
            );
          }
          if (!canSign || report.status !== 'ready') return null;
          return (
            <RowActionPill
              size="sm"
              icon={<PenLine className="h-3 w-3" />}
              label={tSign('sign')}
              title={tSign('sign')}
              pending={sign.isPending}
              disabled={sign.isPending}
              onClick={() => { sign.mutate(report.id); }}
            />
          );
        }
      : undefined;

  return (
    <DetailCard expanded={isOpen} onToggle={onToggle} accent="primary">
      <DetailCardRow
        media={
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.tileClass}`}
          >
            <Icon className="h-4 w-4" />
          </span>
        }
        info={
          <CountChip className="rounded-full bg-surface-high px-2 py-0.5 font-semibold">
            {reports.length}
          </CountChip>
        }
        actions={
          <>
            <RowActionPill
              size="md"
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              label={t('shared.view')}
              title={t('shared.view')}
              disabled={latest.status !== 'ready'}
              onClick={() => { onView(latest.id); }}
            />
            {latest.download_url !== null ? (
              <RowActionPill
                size="md"
                icon={<Download className="h-3.5 w-3.5" />}
                label={t('shared.download')}
                title={t('shared.download')}
                external={latest.download_url}
                download={`${latest.title}.pdf`}
              />
            ) : null}
          </>
        }
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-body3 font-semibold leading-tight text-foreground">
            {t(`types.${reportType}.title`)}
          </span>
          <Badge variant={STATUS_TONE[latest.status]} size="sm" className="shrink-0 capitalize">
            {t(`shared.status.${latest.status}`)}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          <span className="shrink-0">{relative(latest.created_at)}</span>
          {latest.byte_size !== null && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatFileSize(latest.byte_size)}</span>
            </>
          )}
        </div>
      </DetailCardRow>

      <DetailCardBody>
        <p className="mb-3 text-caption text-foreground-tertiary">
          {t(`types.${reportType}.description`)}
        </p>

        {canGenerate && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {templates.length > 0 ? (
              <Select
                value={selectedTemplateId}
                onChange={(e) => { setTemplateOverride(e.target.value); }}
                className="w-44"
                aria-label={t('shared.templateLabel')}
              >
                <option value="">{t('shared.noTemplate')}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                    {tpl.is_default ? ` (${t('shared.defaultSuffix')})` : ''}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button
              variant="primary"
              size="md"
              disabled={generate.isPending}
              onClick={handleGenerate}
            >
              {generate.isPending ? (
                <Spinner size="md" className="mr-1.5 h-3 w-3 text-current" />
              ) : (
                <Sparkles className="mr-1.5 h-3 w-3" />
              )}
              {t('tab.generateNewVersion')}
            </Button>
          </div>
        )}

        <Eyebrow as="div" tone="tertiary" className="mb-2 mt-1 text-primary text-[7px]">
          {t('tab.versionHistory', { count: reports.length })}
        </Eyebrow>
        <ReportVersionTimeline
          versions={versions}
          onView={onView}
          {...(renderVersionActions !== undefined ? { renderActions: renderVersionActions } : {})}
        />
      </DetailCardBody>
    </DetailCard>
  );
}
