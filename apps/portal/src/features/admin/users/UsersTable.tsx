'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button } from '@bimdossier/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { AdminUserRead } from '@/lib/api/schemas';

import { useToggleActivateUser } from './useActivateUser';
import { useTogglePromoteUser } from './usePromoteUser';
import { useUnlockUser } from './useUnlockUser';

type Props = {
  table: TablePagination<AdminUserRead>;
  currentUserId: string | undefined;
};

export function UsersTable({ table, currentUserId }: Props): JSX.Element {
  const t = useTranslations('admin.users.table');
  const tUsers = useTranslations('admin.users');
  const mutation = useTogglePromoteUser();
  const activeMutation = useToggleActivateUser();
  const unlockMutation = useUnlockUser();
  const pending = mutation.isPending || activeMutation.isPending || unlockMutation.isPending;

  const columns: Column<AdminUserRead>[] = [
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
      header: t('access'),
      cell: (u) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={u.is_active ? 'success' : 'error'}>
            {u.is_active ? t('accessActive') : t('accessDisabled')}
          </Badge>
          {u.locked && <Badge variant="warning">{t('lockedBadge')}</Badge>}
        </div>
      ),
    },
    {
      header: t('verified'),
      sortKey: 'is_verified',
      cell: (u) => (
        <Badge variant={u.is_verified ? 'success' : 'warning'}>
          {u.is_verified ? t('verifiedYes') : t('verifiedNo')}
        </Badge>
      ),
    },
    {
      header: t('superuser'),
      sortKey: 'is_superuser',
      cell: (u) => (
        <Badge variant={u.is_superuser ? 'info' : 'default'}>
          {u.is_superuser ? t('superuserYes') : t('superuserNo')}
        </Badge>
      ),
    },
    {
      header: '',
      headerClassName: 'sr-only',
      cell: (u) => {
        const isSelf = u.id === currentUserId;
        return (
          <div className="flex justify-end gap-2">
            {u.locked && (
              <Button
                variant="border"
                size="md"
                disabled={pending}
                onClick={() => {
                  unlockMutation.mutate({ userId: u.id });
                }}
              >
                {t('unlock')}
              </Button>
            )}
            {!isSelf && (
              <Button
                variant={u.is_active ? 'border' : 'primary'}
                size="md"
                disabled={pending}
                onClick={() => {
                  activeMutation.mutate({ userId: u.id, active: !u.is_active });
                }}
              >
                {u.is_active ? t('deactivate') : t('activate')}
              </Button>
            )}
            <Button
              variant={u.is_superuser ? 'border' : 'primary'}
              size="md"
              disabled={pending}
              onClick={() => {
                mutation.mutate({ userId: u.id, superuser: !u.is_superuser });
              }}
            >
              {u.is_superuser ? t('demote') : t('promote')}
            </Button>
          </div>
        );
      },
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
      errorMessage={tUsers('loadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
