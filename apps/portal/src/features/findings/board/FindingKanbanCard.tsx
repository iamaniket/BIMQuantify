import { Clock, FileText, User } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { UserAvatar } from '@/components/shared/UserAvatar';
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

function relativeTime(
  isoDate: string,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('justNow');
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return t('minutesAgo', { count: minutes });
  const days = Math.floor(hours / 24);
  if (days < 1) return t('hoursAgo', { count: hours });
  const weeks = Math.floor(days / 7);
  if (weeks < 1) return t('daysAgo', { count: days });
  return t('weeksAgo', { count: weeks });
}

type Props = {
  finding: Finding;
  assigneeName: string | null;
};

export function FindingKanbanCard({ finding, assigneeName }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.card');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findingsBoard.columns');

  const sev = SEVERITY_STYLES[finding.severity];
  const statusDot = STATUS_DOT[finding.status];

  return (
    <div className="flex flex-col">
      {/* Body */}
      <div className="relative flex flex-col gap-[11px] px-4 pb-3.5 pt-[15px]">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ maskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)' }}
        >
          <BlueprintTexture cellSize={8} />
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
        <div className="relative text-body2 font-semibold leading-tight tracking-tight text-foreground">
          {finding.title}
        </div>

        {/* Description */}
        {finding.description !== '' && (
          <div className="relative line-clamp-2 text-body3 leading-relaxed text-foreground-tertiary">
            {finding.description}
          </div>
        )}

        {/* BBL chip */}
        {finding.bbl_article_ref !== null && finding.bbl_article_ref !== '' && (
          <div className="relative flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary-light px-2 py-px text-caption font-semibold text-primary">
              <FileText className="h-[11px] w-[11px]" />
              {finding.bbl_article_ref}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-low px-4 py-[11px]">
        {assigneeName !== null ? (
          <span className="inline-flex items-center gap-[7px] text-body3 font-medium text-foreground-secondary">
            <UserAvatar name={assigneeName} size="sm" />
            <span className="truncate">{assigneeName}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-[7px] text-body3 text-foreground-tertiary">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-border text-foreground-placeholder">
              <User className="h-[13px] w-[13px]" />
            </span>
            {t('noAssignee')}
          </span>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 text-caption tabular-nums text-foreground-tertiary">
          <Clock className="h-3 w-3" />
          {relativeTime(finding.created_at, t)}
        </span>
      </div>
    </div>
  );
}
