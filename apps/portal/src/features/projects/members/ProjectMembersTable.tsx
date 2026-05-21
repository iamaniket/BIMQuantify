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

import { TableEmptyState } from '@/components/TableEmptyState';
import { ApiError } from '@/lib/api/client';
import type { ProjectMember, ProjectRole } from '@/lib/api/schemas';

import { useRemoveProjectMember } from './useRemoveProjectMember';
import { useUpdateProjectMemberRole } from './useUpdateProjectMemberRole';

type Props = {
  projectId: string;
  members: ProjectMember[];
  canManage: boolean;
};

const ASSIGNABLE_ROLES: ProjectRole[] = [
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
];

function initials(name: string | null, email: string): string {
  if (name !== null) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
  return email[0]?.toUpperCase() ?? '?';
}

export function ProjectMembersTable({ projectId, members, canManage }: Props): JSX.Element {
  const t = useTranslations('projectAccess.table');
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

  if (members.length === 0) {
    return <TableEmptyState message={t('empty')} />;
  }

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
            <TableHead>{t('added')}</TableHead>
            {canManage && <TableHead aria-label={t('actions')} />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const isOwner = m.role === 'owner';
            return (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-lighter text-caption font-bold text-primary">
                      {initials(m.full_name, m.email)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.full_name ?? m.email}</div>
                      {m.full_name !== null && (
                        <div className="truncate text-caption text-foreground-tertiary">{m.email}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={isOwner ? 'info' : 'default'}>
                    {t(`roles.${m.role}` as 'roles.owner')}
                  </Badge>
                </TableCell>
                <TableCell className="text-foreground-tertiary">
                  {new Date(m.created_at).toLocaleDateString()}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
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
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
