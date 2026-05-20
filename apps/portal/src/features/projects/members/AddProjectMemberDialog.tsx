'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type JSX } from 'react';

import { AppDialog, Label, Select } from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import type { ProjectMember, ProjectRoleValue } from '@/lib/api/schemas';

import { useAddProjectMember } from './useAddProjectMember';

const ASSIGNABLE_ROLES: ProjectRoleValue[] = [
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
];

type Props = {
  projectId: string;
  organizationId: string;
  existingMembers: ProjectMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddProjectMemberDialog({
  projectId,
  organizationId,
  existingMembers,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectAccess.addDialog');
  const tRoles = useTranslations('projectAccess.table.roles');
  const orgMembersQuery = useOrgMembers(organizationId, { status: 'active' });
  const addMutation = useAddProjectMember();

  const [userId, setUserId] = useState<string>('');
  const [role, setRole] = useState<ProjectRoleValue>('viewer');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUserId('');
      setRole('viewer');
      setErrorMessage(null);
    }
  }, [open]);

  const existingUserIds = useMemo(
    () => new Set(existingMembers.map((m) => m.user_id)),
    [existingMembers],
  );

  const candidates = useMemo(() => {
    const all = orgMembersQuery.data ?? [];
    return all.filter((m) => !existingUserIds.has(m.user_id));
  }, [orgMembersQuery.data, existingUserIds]);

  const onSave = (): void => {
    setErrorMessage(null);
    if (userId === '') {
      setErrorMessage(t('errors.pickUser'));
      return;
    }
    addMutation.mutate(
      { projectId, input: { user_id: userId, role } },
      {
        onSuccess: () => { onOpenChange(false); },
        onError: (error) => {
          if (error instanceof ApiError) {
            if (error.detail === 'MEMBER_ALREADY_EXISTS') {
              setErrorMessage(t('errors.alreadyMember'));
              return;
            }
            if (error.detail === 'USER_NOT_IN_PROJECT_ORG') {
              setErrorMessage(t('errors.notInOrg'));
              return;
            }
            setErrorMessage(error.detail);
            return;
          }
          setErrorMessage(String(error));
        },
      },
    );
  };

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={onSave}
      saveLabel={t('submit')}
      saveDisabled={addMutation.isPending || candidates.length === 0}
    >
      <div className="flex flex-col gap-4">
        {errorMessage !== null && (
          <div
            className="rounded-md border border-error bg-error/10 px-3 py-2 text-body3 text-error"
            role="alert"
          >
            {errorMessage}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-member-user">{t('fields.user')}</Label>
          <Select
            id="project-member-user"
            value={userId}
            onChange={(e) => { setUserId(e.target.value); }}
            disabled={orgMembersQuery.isLoading || candidates.length === 0}
          >
            <option value="">{t('placeholders.user')}</option>
            {candidates.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name === null ? m.email : `${m.full_name} (${m.email})`}
              </option>
            ))}
          </Select>
          {!orgMembersQuery.isLoading && candidates.length === 0 && (
            <p className="text-caption text-foreground-tertiary">{t('allAlreadyMembers')}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-member-role">{t('fields.role')}</Label>
          <Select
            id="project-member-role"
            value={role}
            onChange={(e) => { setRole(e.target.value as ProjectRoleValue); }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{tRoles(r)}</option>
            ))}
          </Select>
        </div>
      </div>
    </AppDialog>
  );
}
