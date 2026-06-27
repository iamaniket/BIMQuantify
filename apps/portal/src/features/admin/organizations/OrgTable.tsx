'use client';

import { Link } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { Button } from '@bimdossier/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { OrganizationRead } from '@/lib/api/schemas';

import { OrgStatusBadge } from './OrgStatusBadge';
import { RetentionBadge } from './RetentionBadge';
import { SeatUsage } from './SeatUsage';
import { StorageUsage } from './StorageUsage';

export function OrgTable({
  table,
  onPurge,
  purgingId,
}: {
  table: TablePagination<OrganizationRead>;
  /** When provided, the table is in the "deleted" view: a retention-status column
   *  and a per-row "Remove permanently" action are shown (super-admin purge). */
  onPurge?: ((org: OrganizationRead) => void) | undefined;
  purgingId?: string | null | undefined;
}): JSX.Element {
  const t = useTranslations('admin.organizations.table');
  const tOrg = useTranslations('admin.organizations');
  const tPurge = useTranslations('admin.organizations.purge');
  const locale = useLocale() as Locale;
  const showPurge = onPurge !== undefined;

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

  if (showPurge) {
    columns.push({
      header: t('retentionStatus'),
      cell: (org) => <RetentionBadge org={org} />,
    });
    columns.push({
      header: '',
      className: 'text-right',
      cell: (org) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="destructive"
            size="md"
            disabled={!org.is_purge_eligible || org.purged_at !== null || purgingId === org.id}
            onClick={() => { onPurge?.(org); }}
          >
            {tPurge('button')}
          </Button>
        </div>
      ),
    });
  }

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
