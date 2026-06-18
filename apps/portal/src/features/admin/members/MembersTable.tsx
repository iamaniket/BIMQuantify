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
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import { ApiError } from '@/lib/api/client';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { MemberRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { ReassignOwnerDialog } from './ReassignOwnerDialog';
import { useLeaveOrganization } from './useLeaveOrganization';
import { useRemoveMember } from './useRemoveMember';
import { useResendInvite } from './useResendInvite';
import { useUpdateMember } from './useUpdateMember';

type Props = {
  organizationId: string;
  /** Current page of members to display (client-paginated by the parent). */
  table: TablePagination<MemberRead>;
  /** Full member list (unpaginated) — needed to pick a reassignment owner. */
  allMembers: MemberRead[];
  /** Localized message shown when the member list fails to load. */
  loadError: string;
};

const ERROR_CODE_TO_KEY: Record<string, string> = {
  LAST_ADMIN_REQUIRED: 'lastAdminRequired',
  LAST_SUPERUSER_REQUIRED: 'lastSuperuserRequired',
  SELF_ACTION_FORBIDDEN: 'selfActionForbidden',
  INVALID_STATUS_TRANSITION: 'invalidStatusTransition',
  ORG_NOT_ACTIVE: 'orgNotActive',
  INVITATION_EXPIRED: 'invitationExpired',
  REASSIGN_TARGET_NOT_ELIGIBLE: 'reassignTargetNotEligible',
};

export function MembersTable({ organizationId, table, allMembers, loadError }: Props): JSX.Element {
  const t = useTranslations('admin.members.table');
  const locale = useLocale() as Locale;
  const { me } = useAuth();
  const currentUserId = me?.user.id ?? null;

  const updateMutation = useUpdateMember();
  const removeMutation = useRemoveMember();
  const resendMutation = useResendInvite();
  const leaveMutation = useLeaveOrganization();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<{
    userId: string;
    projectIds: string[];
    leave: boolean;
  } | null>(null);

  const handleError = (error: unknown): void => {
    if (error instanceof ApiError) {
      if (error.status === 409 && error.detailObject !== null
        && error.detailObject['code'] === 'OWNS_ACTIVE_PROJECTS') {
        const projectIds = Array.isArray(error.detailObject['project_ids'])
          ? (error.detailObject['project_ids'] as string[])
          : [];
        setReassignFor({ userId: busyUserId ?? '', projectIds, leave: false });
        return;
      }
      const key = ERROR_CODE_TO_KEY[error.detail];
      if (key !== undefined) {
        setErrorMessage(t(`errors.${key}` as 'errors.lastAdminRequired'));
        return;
      }
      setErrorMessage(error.detail);
      return;
    }
    setErrorMessage(String(error));
  };

  const settleBusy = (): void => { setBusyUserId(null); };

  const onRemove = (userId: string): void => {
    setErrorMessage(null);
    setBusyUserId(userId);
    removeMutation.mutate(
      { organizationId, userId },
      {
        onError: (error) => {
          if (error instanceof ApiError
            && error.status === 409
            && error.detailObject !== null
            && error.detailObject['code'] === 'OWNS_ACTIVE_PROJECTS') {
            const projectIds = Array.isArray(error.detailObject['project_ids'])
              ? (error.detailObject['project_ids'] as string[])
              : [];
            setReassignFor({ userId, projectIds, leave: false });
            return;
          }
          handleError(error);
        },
        onSettled: settleBusy,
      },
    );
  };

  const onLeave = (): void => {
    if (currentUserId === null) return;
    setErrorMessage(null);
    setBusyUserId(currentUserId);
    leaveMutation.mutate(
      { organizationId },
      {
        onError: (error) => {
          if (error instanceof ApiError
            && error.status === 409
            && error.detailObject !== null
            && error.detailObject['code'] === 'OWNS_ACTIVE_PROJECTS') {
            const projectIds = Array.isArray(error.detailObject['project_ids'])
              ? (error.detailObject['project_ids'] as string[])
              : [];
            setReassignFor({ userId: currentUserId, projectIds, leave: true });
            return;
          }
          handleError(error);
        },
        onSettled: settleBusy,
      },
    );
  };

  const onReassignConfirm = (newOwnerId: string): void => {
    if (reassignFor === null) return;
    const { userId, leave } = reassignFor;
    setReassignFor(null);
    setBusyUserId(userId);
    const onError = (error: unknown): void => { handleError(error); };
    const onSettled = (): void => { settleBusy(); };
    if (leave) {
      leaveMutation.mutate(
        { organizationId, reassignTo: newOwnerId },
        { onError, onSettled },
      );
    } else {
      removeMutation.mutate(
        { organizationId, userId, reassignTo: newOwnerId },
        { onError, onSettled },
      );
    }
  };

  const reassignCandidates = reassignFor === null
    ? []
    : allMembers.filter(
      (m) => m.user_id !== reassignFor.userId && m.status === 'active',
    );

  const columns: Column<MemberRead>[] = [
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
      cell: (m) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={m.is_org_admin ? 'info' : 'default'}>
            {m.is_org_admin ? t('roleAdmin') : t('roleMember')}
          </Badge>
          {m.is_last_admin && (
            <Badge variant="warning">{t('lastAdminBadge')}</Badge>
          )}
        </div>
      ),
    },
    {
      header: t('status'),
      sortKey: 'status',
      cell: (m) => (
        <Badge
          variant={
            m.status === 'active'
              ? 'success'
              : m.status === 'pending'
                ? 'info'
                : m.status === 'suspended'
                  ? 'warning'
                  : 'default'
          }
        >
          {t(`statuses.${m.status}` as 'statuses.active')}
        </Badge>
      ),
    },
    {
      header: t('invited'),
      sortKey: 'invited',
      className: 'text-foreground-tertiary',
      cell: (m) => formatDate(m.invited_at, locale),
    },
    {
      header: '',
      headerClassName: 'sr-only',
      className: 'text-right',
      cell: (m) => {
        const isSelf = currentUserId !== null && m.user_id === currentUserId;
        const canDemote = m.can_demote && !isSelf;
        const canSuspend = m.can_suspend && !isSelf;
        const canRemove = m.can_remove && !isSelf;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="md"
                aria-label={t('actions')}
                disabled={busyUserId === m.user_id}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {m.status === 'pending' && (
                <DropdownMenuItem
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    resendMutation.mutate(
                      { organizationId, userId: m.user_id },
                      { onError: handleError, onSettled: settleBusy },
                    );
                  }}
                >
                  {t('resendInvite')}
                </DropdownMenuItem>
              )}
              {m.is_org_admin ? (
                <DropdownMenuItem
                  disabled={!canDemote}
                  title={
                    isSelf
                      ? t('tooltips.selfAction')
                      : m.is_last_admin
                        ? t('tooltips.lastAdmin')
                        : undefined
                  }
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    updateMutation.mutate(
                      {
                        organizationId,
                        userId: m.user_id,
                        input: { is_org_admin: false },
                      },
                      { onError: handleError, onSettled: settleBusy },
                    );
                  }}
                >
                  {t('demote')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    updateMutation.mutate(
                      {
                        organizationId,
                        userId: m.user_id,
                        input: { is_org_admin: true },
                      },
                      { onError: handleError, onSettled: settleBusy },
                    );
                  }}
                >
                  {t('promote')}
                </DropdownMenuItem>
              )}
              {m.status === 'active' && (
                <DropdownMenuItem
                  disabled={!canSuspend}
                  title={
                    isSelf
                      ? t('tooltips.selfAction')
                      : !m.can_suspend
                        ? t('tooltips.lastAdmin')
                        : undefined
                  }
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    updateMutation.mutate(
                      {
                        organizationId,
                        userId: m.user_id,
                        input: { status: 'suspended' },
                      },
                      { onError: handleError, onSettled: settleBusy },
                    );
                  }}
                >
                  {t('suspend')}
                </DropdownMenuItem>
              )}
              {m.status === 'suspended' && (
                <DropdownMenuItem
                  onClick={() => {
                    setErrorMessage(null);
                    setBusyUserId(m.user_id);
                    updateMutation.mutate(
                      {
                        organizationId,
                        userId: m.user_id,
                        input: { status: 'active' },
                      },
                      { onError: handleError, onSettled: settleBusy },
                    );
                  }}
                >
                  {t('reactivate')}
                </DropdownMenuItem>
              )}
              {isSelf ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={m.is_last_admin}
                  title={m.is_last_admin ? t('tooltips.lastAdmin') : undefined}
                  onClick={onLeave}
                >
                  {t('leaveOrg')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!canRemove}
                  title={
                    m.is_last_admin ? t('tooltips.lastAdmin') : undefined
                  }
                  onClick={() => { onRemove(m.user_id); }}
                >
                  {t('remove')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      {errorMessage !== null && (
        <ErrorBanner message={errorMessage} className="mx-5 mt-3 shrink-0" />
      )}
      <DataTable
        columns={columns}
        data={table.rows}
        rowKey={(m) => m.user_id}
        emptyMessage={t('empty')}
        sort={table.sort}
        onToggleSort={table.toggleSort}
        isLoading={table.isLoading}
        isFetching={table.isFetching}
        isError={table.isError}
        errorMessage={loadError}
        rowClassName="hover:bg-background-hover"
      />
      {reassignFor !== null && (
        <ReassignOwnerDialog
          open
          projectIds={reassignFor.projectIds}
          candidates={reassignCandidates}
          onConfirm={onReassignConfirm}
          onCancel={() => { setReassignFor(null); }}
        />
      )}
    </>
  );
}
