'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDateTime } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { AuditEntry } from '@/lib/api/schemas';

function summarize(entry: AuditEntry): string {
  const before = entry.before === null ? null : JSON.stringify(entry.before);
  const after = entry.after === null ? null : JSON.stringify(entry.after);
  if (before !== null && after !== null) return `${before} → ${after}`;
  if (after !== null) return after;
  if (before !== null) return before;
  return '';
}

export function AuditLogTable({
  table,
}: {
  table: TablePagination<AuditEntry>;
}): JSX.Element {
  const t = useTranslations('admin.audit.table');
  const tAudit = useTranslations('admin.audit');
  const locale = useLocale() as Locale;

  const columns: Column<AuditEntry>[] = [
    {
      header: t('when'),
      sortKey: 'created_at',
      className: 'whitespace-nowrap font-sans text-caption text-foreground-tertiary',
      cell: (entry) => formatDateTime(entry.created_at, locale),
    },
    {
      header: t('action'),
      sortKey: 'action',
      className: 'font-sans',
      cell: (entry) => entry.action,
    },
    {
      header: t('resource'),
      sortKey: 'resource_type',
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
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(e) => e.id}
      emptyMessage={t('empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={tAudit('loadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
