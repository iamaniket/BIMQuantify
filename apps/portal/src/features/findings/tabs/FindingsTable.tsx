'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { PageTable, type Column } from '@/components/shared/PageTable';
import {
  severityBadgeVariant,
  statusBadgeVariant,
} from '@/features/projects/detail/findingBadges';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding, ProjectMember } from '@/lib/api/schemas';

type Props = {
  findings: Finding[];
  members: ProjectMember[];
  onView: (finding: Finding) => void;
};

export function FindingsTable({ findings, members, onView }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.list.table');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const locale = useLocale() as Locale;

  function getAssigneeName(userId: string | null): string | null {
    if (userId === null) return null;
    const member = members.find((m) => m.user_id === userId);
    return member?.full_name ?? member?.email ?? null;
  }

  const columns: Column<Finding>[] = [
    {
      header: t('title'),
      cell: (f) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { onView(f); }}
            className="truncate font-medium text-foreground hover:underline"
          >
            {f.title}
          </button>
          <Badge variant={severityBadgeVariant(f.severity)} size="sm" bordered>
            {tSeverity(f.severity)}
          </Badge>
        </div>
      ),
    },
    {
      header: t('status'),
      cell: (f) => (
        <Badge variant={statusBadgeVariant(f.status)} size="sm">
          {tStatus(f.status)}
        </Badge>
      ),
    },
    {
      header: t('assignee'),
      className: 'text-foreground-secondary',
      cell: (f) => getAssigneeName(f.assignee_user_id) ?? '—',
    },
    {
      header: t('deadline'),
      className: 'text-foreground-secondary',
      cell: (f) => (f.deadline_date !== null ? formatDate(f.deadline_date, locale) : '—'),
    },
    {
      header: t('ref'),
      className: 'text-foreground-secondary',
      cell: (f) =>
        f.bbl_article_ref !== null && f.bbl_article_ref !== '' ? f.bbl_article_ref : '—',
    },
    {
      header: t('created'),
      className: 'text-foreground-tertiary',
      cell: (f) => formatDate(f.created_at, locale),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={findings}
      rowKey={(f) => f.id}
      emptyMessage={t('empty')}
    />
  );
}
