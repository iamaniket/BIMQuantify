'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { MemberRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { ReassignOwnerDialog } from './ReassignOwnerDialog';
import { useLeaveOrganization } from './useLeaveOrganization';
import { useRemoveMember } from './useRemoveMember';
import { useResendInvite } from './useResendInvite';
import { useUpdateMember } from './useUpdateMember';

type Props = {
  organizationId: string;
  members: MemberRead[];
};

// Maps API error codes to portal i18n keys under `admin.members.table.errors`.
// Falls back to the raw code for unmapped values so the user still sees
// something rather than a silent failure.
const ERROR_CODE_TO_KEY: Record<string, string> = {
  LAST_ADMIN_REQUIRED: 'lastAdminRequired',
  LAST_SUPERUSER_REQUIRED: 'lastSuperuserRequired',
  SELF_ACTION_FORBIDDEN: 'selfActionForbidden',
  INVALID_STATUS_TRANSITION: 'invalidStatusTransition',
  ORG_NOT_ACTIVE: 'orgNotActive',
  INVITATION_EXPIRED: 'invitationExpired',
  REASSIGN_TARGET_NOT_ELIGIBLE: 'reassignTargetNotEligible',
};

export function MembersTable({ organizationId, members }: Props): JSX.Element {
  const t = useTranslations('admin.members.table');
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
        // The dialog re-issues the mutation with reassign_to; this branch
        // is only reached if the caller hasn't already routed through it.
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

  const onRemove = (userId: string, m: MemberRead): void => {
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

  if (members.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  // Reassign-target candidates: active members other than the one being
  // removed. Pending/suspended would inherit a project they can't open.
  const reassignCandidates = reassignFor === null
    ? []
    : members.filter(
      (m) => m.user_id !== reassignFor.userId && m.status === 'active',
    );

  return (
    <>
      {errorMessage !== null && (
        <div
          className="mb-3 rounded-md border border-error bg-error/10 px-3 py-2 text-body3 text-error"
          role="alert"
        >
          {errorMessage}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('user')}</TableHead>
            <TableHead>{t('role')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>{t('invited')}</TableHead>
            <TableHead aria-label={t('actions')} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const isSelf = currentUserId !== null && m.user_id === currentUserId;
            const canDemote = m.can_demote && !isSelf;
            const canSuspend = m.can_suspend && !isSelf;
            const canRemove = m.can_remove && !isSelf;
            return (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="font-medium">{m.full_name ?? m.email}</div>
                  {m.full_name !== null && (
                    <div className="text-caption text-foreground-tertiary">{m.email}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={m.is_org_admin ? 'info' : 'default'}>
                      {m.is_org_admin ? t('roleAdmin') : t('roleMember')}
                    </Badge>
                    {m.is_last_admin && (
                      <Badge variant="warning">{t('lastAdminBadge')}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
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
                </TableCell>
                <TableCell className="text-foreground-tertiary">
                  {new Date(m.invited_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
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
                          onClick={() => { onRemove(m.user_id, m); }}
                        >
                          {t('remove')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
