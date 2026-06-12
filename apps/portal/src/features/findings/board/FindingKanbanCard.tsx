import {
  AlertCircle,
  Box,
  CalendarClock,
  CalendarDays,
  Camera,
  ClipboardCheck,
  FileText,
  LinkIcon,
  MapPin,
  Paperclip,
  RefreshCw,
  User,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentType, JSX, ReactNode } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding, FindingSeverityValue, FindingStatusValue } from '@/lib/api/schemas';

const SEVERITY_STYLES: Record<FindingSeverityValue, { pill: string; dot: string }> = {
  high: { pill: 'text-error bg-error-light', dot: 'bg-error' },
  medium: { pill: 'text-warning bg-warning-light', dot: 'bg-warning' },
  low: { pill: 'text-info bg-info-light', dot: 'bg-info' },
};

const STATUS_DOT: Record<FindingStatusValue, string> = {
  draft: 'bg-foreground-tertiary',
  open: 'bg-info',
  in_progress: 'bg-primary',
  resolved: 'bg-success',
  verified: 'bg-success',
};

/** Past its deadline and still actionable (not resolved/verified). */
function isOverdue(deadlineDate: string | null, status: FindingStatusValue): boolean {
  if (deadlineDate === null) return false;
  if (status === 'resolved' || status === 'verified') return false;
  const due = new Date(deadlineDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

/** Render a template custom-field value compactly; '' means "skip this chip". */
function formatCustomValue(type: string, value: unknown, locale: Locale): string {
  if (value === null || value === undefined) return '';
  if (type === 'checkbox' || typeof value === 'boolean') {
    return value === true ? '✓' : '';
  }
  if (type === 'date' && typeof value === 'string') {
    return formatDate(value, locale, '');
  }
  return String(value).trim();
}

function MetaChip({
  icon: IconCmp,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-low px-1.5 py-px text-caption font-medium tabular-nums text-foreground-secondary"
    >
      <IconCmp className="h-3 w-3 text-foreground-tertiary" />
      {children}
    </span>
  );
}

type Props = {
  finding: Finding;
  assigneeName: string | null;
  reporterName: string | null;
};

export function FindingKanbanCard({ finding, assigneeName, reporterName }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.card');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findingsBoard.columns');
  const locale = useLocale() as Locale;

  const sev = SEVERITY_STYLES[finding.severity];
  const statusDot = STATUS_DOT[finding.status];

  const createdLabel = formatDate(finding.created_at, locale, '');
  const updatedLabel = formatDate(finding.updated_at, locale, '');
  const overdue = isOverdue(finding.deadline_date, finding.status);

  const hasBbl = finding.bbl_article_ref !== null && finding.bbl_article_ref !== '';
  const isLinked =
    finding.linked_model_id !== null
    || finding.linked_file_id !== null
    || finding.linked_element_global_id !== null;
  const linkedLabel = finding.linked_file_type !== null ? finding.linked_file_type.toUpperCase() : null;
  const photoCount = finding.photo_ids?.length ?? 0;
  const refCount = finding.reference_attachment_ids?.length ?? 0;
  const hasMetaRow = hasBbl || isLinked || photoCount > 0 || refCount > 0;

  const showLoggedBy = reporterName !== null && reporterName !== assigneeName;

  const customEntries = Object.entries(finding.custom_values ?? {})
    .map(([key, field]) => ({ key, label: field.label, value: formatCustomValue(field.type, field.value, locale) }))
    .filter((entry) => entry.value !== '');
  const shownCustom = customEntries.slice(0, 2);
  const extraCustom = customEntries.length - shownCustom.length;

  return (
    <div className="flex flex-col">
      {/* Body */}
      <div className="relative flex flex-col gap-[11px] px-4 pb-3.5 pt-[15px]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ maskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)' }}
        >
          <BlueprintTexture cellSize={13} />
        </div>

        {/* Top row — status + severity */}
        <div className="relative flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-foreground-tertiary">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
            {tStatus(finding.status)}
          </span>
          <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-caption font-bold uppercase tracking-wider ${sev.pill}`}>
            <span className={`h-[5px] w-[5px] rounded-full ${sev.dot}`} />
            {tSeverity(finding.severity)}
          </span>
        </div>

        {/* Title */}
        <div className="relative line-clamp-2 text-body2 font-semibold leading-tight tracking-tight text-foreground">
          {finding.title}
        </div>

        {/* Description */}
        {finding.description !== '' && (
          <div className="relative line-clamp-2 text-body3 leading-relaxed text-foreground-tertiary">
            {finding.description}
          </div>
        )}

        {/* Meta chips — BBL ref, model/drawing link, photos, attachments */}
        {hasMetaRow && (
          <div className="relative flex flex-wrap items-center gap-1.5">
            {hasBbl && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary-light px-2 py-px text-caption font-semibold text-primary">
                <FileText className="h-[11px] w-[11px]" />
                {finding.bbl_article_ref}
              </span>
            )}
            {isLinked && (
              linkedLabel !== null ? (
                <MetaChip icon={finding.linked_file_type === 'ifc' ? Box : MapPin} title={t('linkedTitle')}>
                  {linkedLabel}
                </MetaChip>
              ) : (
                <MetaChip icon={LinkIcon} title={t('linkedTitle')} />
              )
            )}
            {photoCount > 0 && (
              <MetaChip icon={Camera} title={t('photosTitle')}>{photoCount}</MetaChip>
            )}
            {refCount > 0 && (
              <MetaChip icon={Paperclip} title={t('attachmentsTitle')}>{refCount}</MetaChip>
            )}
          </div>
        )}

        {/* Template custom-field values */}
        {shownCustom.length > 0 && (
          <div className="relative flex flex-wrap items-center gap-1.5">
            <span title={t('fromTemplate')} className="inline-flex shrink-0 items-center">
              <ClipboardCheck className="h-3 w-3 text-foreground-tertiary" />
            </span>
            {shownCustom.map((entry) => (
              <span
                key={entry.key}
                className="inline-flex max-w-[150px] items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-px text-caption"
              >
                <span className="shrink-0 text-foreground-tertiary">{entry.label}</span>
                <span className="truncate font-medium text-foreground-secondary">{entry.value}</span>
              </span>
            ))}
            {extraCustom > 0 && (
              <span className="text-caption font-medium text-foreground-tertiary">+{extraCustom}</span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative overflow-hidden border-t border-border bg-surface-high">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ maskImage: 'linear-gradient(to top, black 0%, transparent 70%)' }}
        >
          <BlueprintTexture cellSize={13} className="opacity-[0.10]" />
        </div>

        <div className="relative flex flex-col gap-2 px-4 py-3">
          {/* People + deadline */}
          <div className="flex items-center justify-between gap-2">
            {assigneeName !== null ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <UserAvatar name={assigneeName} size="md" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-body3 font-medium text-foreground-secondary">{assigneeName}</span>
                  {showLoggedBy && (
                    <span className="truncate text-caption text-foreground-placeholder">
                      {t('loggedBy', { name: reporterName ?? '' })}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-border text-foreground-placeholder">
                  <User className="h-[15px] w-[15px]" />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-body3 text-foreground-tertiary">{t('noAssignee')}</span>
                  {showLoggedBy && (
                    <span className="truncate text-caption text-foreground-placeholder">
                      {t('loggedBy', { name: reporterName ?? '' })}
                    </span>
                  )}
                </span>
              </span>
            )}

            {finding.deadline_date !== null && (
              <span
                title={overdue ? t('overdue') : t('dueTitle')}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-caption font-semibold tabular-nums ${
                  overdue ? 'bg-error-light text-error' : 'border border-border bg-background text-foreground-secondary'
                }`}
              >
                {overdue ? <AlertCircle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                {formatDate(finding.deadline_date, locale)}
              </span>
            )}
          </div>

          {/* Created / last-updated dates */}
          <div className="flex items-center gap-3 border-t border-dashed border-border pt-2 text-caption tabular-nums text-foreground-tertiary">
            <span title={t('createdTitle')} className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              {createdLabel === '' ? '—' : createdLabel}
            </span>
            {updatedLabel !== createdLabel && updatedLabel !== '' && (
              <span title={t('updatedTitle')} className="inline-flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                {updatedLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
