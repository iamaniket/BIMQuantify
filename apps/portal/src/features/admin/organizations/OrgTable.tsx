'use client';

import { Link } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { OrganizationRead } from '@/lib/api/schemas';

import { OrgStatusBadge } from './OrgStatusBadge';
import { SeatUsage } from './SeatUsage';
import { StorageUsage } from './StorageUsage';

export function OrgTable({
  table,
}: {
  table: TablePagination<OrganizationRead>;
}): JSX.Element {
  const t = useTranslations('admin.organizations.table');
  const tOrg = useTranslations('admin.organizations');
  const locale = useLocale() as Locale;

  const columns: Column<OrganizationRead>[] = [
    {
      header: t('name'),
      sortKey: 'name',
      cell: (org) => (
        <>
          <Link
            href={`/admin/organizations/${org.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {org.name}
          </Link>
          <div className="font-sans text-caption text-foreground-tertiary">
            {org.schema_name}
          </div>
        </>
      ),
    },
    {
      header: t('status'),
      sortKey: 'status',
      cell: (org) => <OrgStatusBadge status={org.status} />,
    },
    {
      header: t('seats'),
      cell: (org) => (
        <SeatUsage seatCountUsed={org.seat_count_used} seatLimit={org.seat_limit} />
      ),
    },
    {
      header: t('storage'),
      cell: (org) => (
        <StorageUsage usedGb={org.active_storage_used_gb} limitGb={org.active_storage_limit_gb} />
      ),
    },
    {
      header: t('created'),
      sortKey: 'created_at',
      className: 'text-foreground-tertiary',
      cell: (org) => formatDate(org.created_at, locale),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(o) => o.id}
      emptyMessage={t('empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={tOrg('loadError')}
    />
  );
}
