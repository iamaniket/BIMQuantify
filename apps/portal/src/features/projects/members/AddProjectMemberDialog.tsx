'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type JSX } from 'react';

import {
  AppDialog,
  Input,
  Label,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ApiError } from '@/lib/api/client';
import { useSelectableOrgMembers } from '@/features/admin/members/useSelectableOrgMembers';
import type { ProjectMember, ProjectRole } from '@/lib/api/schemas';

import { useAddProjectMember } from './useAddProjectMember';
import { useInviteToProject } from './useInviteToProject';

const ASSIGNABLE_ROLES: ProjectRole[] = [
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddProjectMemberDialog({
  projectId,
  organizationId,
  existingMembers,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectAccess.addDialog');
  const tRoles = useTranslations('projectAccess.table.roles');
  // Member-callable picker source: works for non-admin project owners (the
  // full org-member list is org-admin only) and already excludes guests.
  const orgMembersQuery = useSelectableOrgMembers(organizationId);
  const addMutation = useAddProjectMember();
  const inviteMutation = useInviteToProject();

  const [tab, setTab] = useState<'fromOrg' | 'invite'>('fromOrg');
  const [userId, setUserId] = useState<string>('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab('fromOrg');
      setUserId('');
      setRole('viewer');
      setEmail('');
      setFullName('');
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

  const isPending = addMutation.isPending || inviteMutation.isPending;

  const handleError = (error: unknown): void => {
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
  };

  const onSave = (): void => {
    setErrorMessage(null);

    if (tab === 'fromOrg') {
      if (userId === '') {
        setErrorMessage(t('errors.pickUser'));
        return;
      }
      addMutation.mutate(
        { projectId, input: { user_id: userId, role } },
        {
          onSuccess: () => { onOpenChange(false); },
          onError: handleError,
        },
      );
    } else {
      const trimmed = email.trim();
      if (!EMAIL_RE.test(trimmed)) {
        setErrorMessage(t('errors.invalidEmail'));
        return;
      }
      inviteMutation.mutate(
        {
          projectId,
          input: {
            email: trimmed,
            role,
            full_name: fullName.trim() || null,
          },
        },
        {
          onSuccess: () => { onOpenChange(false); },
          onError: handleError,
        },
      );
    }
  };

  const saveDisabled =
    isPending ||
    (tab === 'fromOrg' && candidates.length === 0);

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={onSave}
      saveLabel={t('submit')}
      saveDisabled={saveDisabled}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'fromOrg' | 'invite');
          setErrorMessage(null);
        }}
      >
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="fromOrg" className="flex-1">
            {t('tabs.fromOrg')}
          </TabsTrigger>
          <TabsTrigger value="invite" className="flex-1">
            {t('tabs.inviteByEmail')}
          </TabsTrigger>
        </TabsList>

        <ErrorBanner message={errorMessage} className="mb-4" />

        <TabsContent value="fromOrg">
          <div className="flex flex-col gap-4">
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
              <Label htmlFor="project-member-role-org">{t('fields.role')}</Label>
              <Select
                id="project-member-role-org"
                value={role}
                onChange={(e) => { setRole(e.target.value as ProjectRole); }}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{tRoles(r)}</option>
                ))}
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="invite">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">{t('fields.email')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder={t('placeholders.email')}
                value={email}
                onChange={(e) => { setEmail(e.target.value); }}
              />
              <p className="text-caption text-foreground-tertiary">
                {t('guestHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-full-name">{t('fields.fullName')}</Label>
              <Input
                id="invite-full-name"
                type="text"
                placeholder={t('placeholders.fullName')}
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-member-role-invite">{t('fields.role')}</Label>
              <Select
                id="project-member-role-invite"
                value={role}
                onChange={(e) => { setRole(e.target.value as ProjectRole); }}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{tRoles(r)}</option>
                ))}
              </Select>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </AppDialog>
  );
}
