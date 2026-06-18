'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { PageHeader } from '@bimstitch/ui';

import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { listGlobalAuditLogPage } from '@/lib/api/admin';
import { useTableQuery } from '@/lib/query/useTableQuery';
import type { AuditEntry } from '@/lib/api/schemas';

export default function AdminAuditLogPage(): JSX.Element {
  const t = useTranslations('admin.audit');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  const filters = {
    action: actionFilter === '' ? undefined : actionFilter,
    resource_type: resourceFilter === '' ? undefined : resourceFilter,
  };
  const table = useTableQuery<AuditEntry, typeof filters>({
    filters,
    queryKey: (p) => ['admin', 'audit-log', 'global', p] as const,
    queryFn: (token, p) => listGlobalAuditLogPage(token, p),
    initialPageSize: 50,
    initialSort: { key: 'created_at', dir: 'desc' },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-6 sm:px-6 lg:px-8">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={undefined}
          className={undefined}
        />
      </div>

      <TableToolbar>
        <SearchInput
          placeholder={t('filterActionPlaceholder')}
          value={actionFilter}
          onChange={setActionFilter}
          aria-label={t('filterActionAria')}
        />
        <SearchInput
          placeholder={t('filterResourcePlaceholder')}
          value={resourceFilter}
          onChange={setResourceFilter}
          aria-label={t('filterResourceAria')}
        />
      </TableToolbar>

      <AuditLogTable table={table} />

      <TablePaginationFooter
        table={table}
        className="shrink-0 border-t border-border px-5 py-2.5"
      />
    </div>
  );
}
