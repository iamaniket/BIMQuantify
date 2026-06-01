import { Calendar, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import type { Finding, FindingSeverityValue } from '@/lib/api/schemas';
import type { BadgeVariant } from '@bimstitch/ui';

function severityVariant(severity: FindingSeverityValue): BadgeVariant {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'default';
    default:
      return 'default';
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isOverdue(deadlineDate: string): boolean {
  return new Date(deadlineDate) < new Date(new Date().toDateString());
}

type Props = {
  finding: Finding;
  assigneeName: string | null;
};

export function FindingKanbanCard({ finding, assigneeName }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.card');
  const tSeverity = useTranslations('findings.severity');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="line-clamp-2 text-body3 font-semibold leading-tight text-foreground">
          {finding.title}
        </span>
        <Badge variant={severityVariant(finding.severity)} size="sm" bordered className="shrink-0">
          {tSeverity(finding.severity)}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-caption text-foreground-tertiary">
        <User className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {assigneeName ?? t('noAssignee')}
        </span>
      </div>

      {finding.deadline_date !== null && (
        <div className={`flex items-center gap-1.5 text-caption ${isOverdue(finding.deadline_date) ? 'text-error' : 'text-foreground-tertiary'}`}>
          <Calendar className="h-3 w-3 shrink-0" />
          <span>{formatDate(finding.deadline_date)}</span>
        </div>
      )}

      {finding.bbl_article_ref !== null && finding.bbl_article_ref !== '' && (
        <div className="text-caption text-foreground-tertiary">
          {finding.bbl_article_ref}
        </div>
      )}
    </div>
  );
}
