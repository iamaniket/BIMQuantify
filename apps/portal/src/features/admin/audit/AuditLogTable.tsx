'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { PageTable, type Column } from '@/components/shared/PageTable';
import { formatDateTime } from '@/lib/formatting/dates';
import type { AuditEntry } from '@/lib/api/schemas';

function summarize(entry: AuditEntry): string {
  const before = entry.before === null ? null : JSON.stringify(entry.before);
  const after = entry.after === null ? null : JSON.stringify(entry.after);
  if (before !== null && after !== null) return `${before} → ${after}`;
  if (after !== null) return after;
  if (before !== null) return before;
  return '';
}

export function AuditLogTable({ entries }: { entries: AuditEntry[] }): JSX.Element {
  const t = useTranslations('admin.audit.table');
  const locale = useLocale() as Locale;

  const columns: Column<AuditEntry>[] = [
    {
      header: t('when'),
      className: 'whitespace-nowrap font-sans text-caption text-foreground-tertiary',
      cell: (entry) => formatDateTime(entry.created_at, locale),
    },
    {
      header: t('action'),
      className: 'font-sans',
      cell: (entry) => entry.action,
    },
    {
      header: t('resource'),
      className: 'font-sans text-foreground-tertiary',
      cell: (entry) => (
        <>
          {entry.resource_type}
          {entry.resource_id !== null && (
            <span className="block text-caption">{entry.resource_id}</span>
          )}
        </>
      ),
    },
    {
      header: t('change'),
      className: 'max-w-[480px] truncate font-sans text-caption text-foreground-tertiary',
      cell: (entry) => summarize(entry),
    },
  ];

  return (
    <PageTable
      columns={columns}
      data={entries}
      rowKey={(e) => e.id}
      emptyMessage={t('empty')}
      rowClassName=""
    />
  );
}
