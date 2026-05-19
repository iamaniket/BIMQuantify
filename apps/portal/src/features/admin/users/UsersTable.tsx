'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

import type { AdminUserRead } from '@/lib/api/schemas';

import { useToggleActivateUser } from './useActivateUser';
import { useTogglePromoteUser } from './usePromoteUser';

type Props = {
  users: AdminUserRead[];
  /** Hides the deactivate action for the row matching this id (typically the
   * current super-admin) so the UI doesn't tempt the locked-out scenario. */
  currentUserId: string | undefined;
};

export function UsersTable({ users, currentUserId }: Props): JSX.Element {
  const t = useTranslations('admin.users.table');
  const mutation = useTogglePromoteUser();
  const activeMutation = useToggleActivateUser();
  const pending = mutation.isPending || activeMutation.isPending;

  if (users.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('user')}</TableHead>
          <TableHead>{t('access')}</TableHead>
          <TableHead>{t('verified')}</TableHead>
          <TableHead>{t('superuser')}</TableHead>
          <TableHead aria-label={t('actions')} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <TableRow key={u.id}>
              <TableCell>
                <div className="font-medium">{u.full_name ?? u.email}</div>
                {u.full_name !== null && (
                  <div className="text-caption text-foreground-tertiary">{u.email}</div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={u.is_active ? 'success' : 'error'}>
                  {u.is_active ? t('accessActive') : t('accessDisabled')}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={u.is_verified ? 'success' : 'warning'}>
                  {u.is_verified ? t('verifiedYes') : t('verifiedNo')}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={u.is_superuser ? 'info' : 'default'}>
                  {u.is_superuser ? t('superuserYes') : t('superuserNo')}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {!isSelf && (
                    <Button
                      variant={u.is_active ? 'border' : 'primary'}
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        activeMutation.mutate({
                          userId: u.id,
                          active: !u.is_active,
                        });
                      }}
                    >
                      {u.is_active ? t('deactivate') : t('activate')}
                    </Button>
                  )}
                  <Button
                    variant={u.is_superuser ? 'border' : 'primary'}
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      mutation.mutate({ userId: u.id, superuser: !u.is_superuser });
                    }}
                  >
                    {u.is_superuser ? t('demote') : t('promote')}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
