'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button, CountChip, Progress } from '@bimdossier/ui';

import type { Locale } from '@bimdossier/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import type { FreeUserRead } from '@/lib/api/schemas';
import { formatDate } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';
import type { TablePagination } from '@/lib/query/useTableQuery';

import { isStaleAccount } from './staleness';

type Props = {
  table: TablePagination<FreeUserRead>;
  onManage: (user: FreeUserRead) => void;
};

function storageVariant(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 100) return 'error';
  if (pct >= 70) return 'warning';
  return 'success';
}

export function FreeUsersTable({ table, onManage }: Props): JSX.Element {
  const t = useTranslations('admin.freeUsers.table');
  const tFree = useTranslations('admin.freeUsers');
  const locale = useLocale() as Locale;

  const columns: Column<FreeUserRead>[] = [
    {
      header: t('user'),
      sortKey: 'email',
      cell: (u) => (
        <>
          <div className="font-medium">{u.full_name ?? u.email}</div>
          {u.full_name !== null && (
            <div className="text-caption text-foreground-tertiary">{u.email}</div>
          )}
        </>
      ),
    },
    {
      header: t('company'),
      cell: (u) => (
        <span className="text-body3 text-foreground-secondary">
          {u.company ?? '—'}
        </span>
      ),
    },
    {
      header: t('storage'),
      cell: (u) => {
        const used = u.usage.storage_bytes_used;
        const cap = u.usage.storage_bytes_cap;
        const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
        return (
          <div className="flex w-40 flex-col gap-1">
            <Progress value={pct} variant={storageVariant(pct)} />
            <div className="flex items-center justify-between text-caption tabular-nums text-foreground-tertiary">
              <span>{t('storageUsage', { used: formatFileSize(used), cap: formatFileSize(cap) })}</span>
              <span>{t('storagePct', { pct })}</span>
            </div>
          </div>
        );
      },
    },
    {
      header: t('containers'),
      cell: (u) => (
        <CountChip>
          {t('countOfCap', { count: u.usage.document_count, cap: u.usage.document_cap })}
        </CountChip>
      ),
    },
    {
      header: t('created'),
      sortKey: 'created_at',
      cell: (u) => (
        <span className="text-body3 tabular-nums text-foreground-secondary">
          {formatDate(u.created_at, locale)}
        </span>
      ),
    },
    {
      header: t('lastActive'),
      cell: (u) => {
        const last = u.usage.last_activity_at ?? null;
        const stale = isStaleAccount(u.created_at, last);
        return (
          <div className="flex items-center gap-1.5">
            <span
              className={
                stale
                  ? 'text-body3 tabular-nums text-warning'
                  : 'text-body3 tabular-nums text-foreground-secondary'
              }
            >
              {last !== null ? formatDate(last, locale) : t('neverActive')}
            </span>
            {stale && (
              <Badge variant="warning" size="sm">
                {t('staleBadge')}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      header: t('status'),
      cell: (u) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={u.is_active ? 'success' : 'error'}>
            {u.is_active ? t('statusActive') : t('statusSuspended')}
          </Badge>
          {!u.is_verified && <Badge variant="warning">{t('statusUnverified')}</Badge>}
          {u.locked && <Badge variant="warning">{t('lockedBadge')}</Badge>}
        </div>
      ),
    },
    {
      header: '',
      headerClassName: 'sr-only',
      cell: (u) => (
        <div className="flex justify-end">
          <Button variant="border" size="md" onClick={() => { onManage(u); }}>
            {t('manage')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(u) => u.id}
      emptyMessage={t('empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={tFree('loadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
