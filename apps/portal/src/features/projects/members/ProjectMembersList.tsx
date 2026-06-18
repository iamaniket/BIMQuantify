'use client';

import { MoreHorizontal } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@bimstitch/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { ProjectMember, ProjectRole } from '@/lib/api/schemas';

import { useRemoveProjectMember } from './useRemoveProjectMember';
import { useUpdateProjectMemberRole } from './useUpdateProjectMemberRole';

type Props = {
  projectId: string;
  table: TablePagination<ProjectMember>;
  canManage: boolean;
  /** Localized message shown when the (filtered) list is empty. */
  emptyMessage: string;
  /** Localized message shown when the member list fails to load. */
  loadError: string;
};

// Roles that can be assigned/changed via the UI. Owner is excluded — it's
// set once at project creation and isn't transferable in this iteration.
const ASSIGNABLE_ROLES: ProjectRole[] = [
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
];

export function ProjectMembersList({
  projectId,
  table,
  canManage,
  emptyMessage,
  loadError,
}: Props): JSX.Element {
  const t = useTranslations('projectAccess.table');
  const locale = useLocale() as Locale;
  const updateMutation = useUpdateProjectMemberRole();
  const removeMutation = useRemoveProjectMember();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleError = (error: unknown): void => {
    if (error instanceof ApiError) {
      setErrorMessage(error.detail);
      return;
    }
    setErrorMessage(String(error));
  };

  const settle = (): void => { setBusyUserId(null); };

  const columns: Column<ProjectMember>[] = [
    {
      header: t('user'),
      sortKey: 'name',
      cell: (m) => (
        <>
          <div className="font-medium">{m.full_name ?? m.email}</div>
          {m.full_name !== null && (
            <div className="text-caption text-foreground-tertiary">{m.email}</div>
          )}
        </>
      ),
    },
    {
      header: t('role'),
      sortKey: 'role',
      cell: (m) => (
        <Badge variant={m.role === 'owner' ? 'info' : 'default'}>
          {t(`roles.${m.role}` as 'roles.owner')}
        </Badge>
      ),
    },
    {
      header: t('added'),
      sortKey: 'added',
      className: 'text-foreground-tertiary',
      cell: (m) => formatDate(m.created_at, locale),
    },
  ];

  if (canManage) {
    columns.push({
      header: '',
      headerClassName: 'sr-only',
      className: 'text-right',
      cell: (m) => {
        const isOwner = m.role === 'owner';
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="md"
                aria-label={t('actions')}
                disabled={busyUserId === m.user_id || isOwner}
                title={isOwner ? t('ownerLocked') : undefined}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ASSIGNABLE_ROLES.filter((r) => r !== m.role).map((role) => (
                <DropdownMenuItem
                  key={role}
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    updateMutation.mutate(
                      { projectId, userId: m.user_id, input: { role } },
                      { onError: handleError, onSettled: settle },
                    );
                  }}
                >
                  {t('setRole', { role: t(`roles.${role}` as 'roles.editor') })}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setErrorMessage(null);
                  setBusyUserId(m.user_id);
                  removeMutation.mutate(
                    { projectId, userId: m.user_id },
                    { onError: handleError, onSettled: settle },
                  );
                }}
              >
                {t('remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  return (
    <>
      {errorMessage !== null && (
        <ErrorBanner message={errorMessage} className="mx-5 mt-3 shrink-0" />
      )}
      <DataTable
        columns={columns}
        data={table.rows}
        rowKey={(m) => m.user_id}
        emptyMessage={emptyMessage}
        sort={table.sort}
        onToggleSort={table.toggleSort}
        isLoading={table.isLoading}
        isFetching={table.isFetching}
        isError={table.isError}
        errorMessage={loadError}
        rowClassName="hover:bg-background-hover"
      />
    </>
  );
}
