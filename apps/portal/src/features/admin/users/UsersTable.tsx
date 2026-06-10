'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Button } from '@bimstitch/ui';

import { PageTable, type Column } from '@/components/shared/PageTable';
import type { AdminUserRead } from '@/lib/api/schemas';

import { useToggleActivateUser } from './useActivateUser';
import { useTogglePromoteUser } from './usePromoteUser';

type Props = {
  users: AdminUserRead[];
  currentUserId: string | undefined;
};

export function UsersTable({ users, currentUserId }: Props): JSX.Element {
  const t = useTranslations('admin.users.table');
  const mutation = useTogglePromoteUser();
  const activeMutation = useToggleActivateUser();
  const pending = mutation.isPending || activeMutation.isPending;

  const columns: Column<AdminUserRead>[] = [
    {
      header: t('user'),
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
        <Badge variant={u.is_active ? 'success' : 'error'}>
          {u.is_active ? t('accessActive') : t('accessDisabled')}
        </Badge>
      ),
    },
    {
      header: t('verified'),
      cell: (u) => (
        <Badge variant={u.is_verified ? 'success' : 'warning'}>
          {u.is_verified ? t('verifiedYes') : t('verifiedNo')}
        </Badge>
      ),
    },
    {
      header: t('superuser'),
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
    <PageTable
      columns={columns}
      data={users}
      rowKey={(u) => u.id}
      emptyMessage={t('empty')}
      rowClassName=""
    />
  );
}
