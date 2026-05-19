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

import type { MemberRead } from '@/lib/api/schemas';

import { useRemoveMember } from './useRemoveMember';
import { useResendInvite } from './useResendInvite';
import { useUpdateMember } from './useUpdateMember';

type Props = {
  organizationId: string;
  members: MemberRead[];
};

export function MembersTable({ organizationId, members }: Props): JSX.Element {
  const t = useTranslations('admin.members.table');
  const updateMutation = useUpdateMember();
  const removeMutation = useRemoveMember();
  const resendMutation = useResendInvite();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  if (members.length === 0) {
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
          <TableHead>{t('role')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('invited')}</TableHead>
          <TableHead aria-label={t('actions')} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.user_id}>
            <TableCell>
              <div className="font-medium">{m.full_name ?? m.email}</div>
              {m.full_name !== null && (
                <div className="text-caption text-foreground-tertiary">{m.email}</div>
              )}
            </TableCell>
            <TableCell>
              <Badge variant={m.is_org_admin ? 'info' : 'default'}>
                {m.is_org_admin ? t('roleAdmin') : t('roleMember')}
              </Badge>
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
                        setBusyUserId(m.user_id);
                        resendMutation.mutate(
                          { organizationId, userId: m.user_id },
                          { onSettled: () => { setBusyUserId(null); } },
                        );
                      }}
                    >
                      {t('resendInvite')}
                    </DropdownMenuItem>
                  )}
                  {m.is_org_admin ? (
                    <DropdownMenuItem
                      onClick={() => {
                        setBusyUserId(m.user_id);
                        updateMutation.mutate(
                          {
                            organizationId,
                            userId: m.user_id,
                            input: { is_org_admin: false },
                          },
                          { onSettled: () => { setBusyUserId(null); } },
                        );
                      }}
                    >
                      {t('demote')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        setBusyUserId(m.user_id);
                        updateMutation.mutate(
                          {
                            organizationId,
                            userId: m.user_id,
                            input: { is_org_admin: true },
                          },
                          { onSettled: () => { setBusyUserId(null); } },
                        );
                      }}
                    >
                      {t('promote')}
                    </DropdownMenuItem>
                  )}
                  {m.status === 'active' && (
                    <DropdownMenuItem
                      onClick={() => {
                        setBusyUserId(m.user_id);
                        updateMutation.mutate(
                          {
                            organizationId,
                            userId: m.user_id,
                            input: { status: 'suspended' },
                          },
                          { onSettled: () => { setBusyUserId(null); } },
                        );
                      }}
                    >
                      {t('suspend')}
                    </DropdownMenuItem>
                  )}
                  {m.status === 'suspended' && (
                    <DropdownMenuItem
                      onClick={() => {
                        setBusyUserId(m.user_id);
                        updateMutation.mutate(
                          {
                            organizationId,
                            userId: m.user_id,
                            input: { status: 'active' },
                          },
                          { onSettled: () => { setBusyUserId(null); } },
                        );
                      }}
                    >
                      {t('reactivate')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setBusyUserId(m.user_id);
                      removeMutation.mutate(
                        { organizationId, userId: m.user_id },
                        { onSettled: () => { setBusyUserId(null); } },
                      );
                    }}
                  >
                    {t('remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
