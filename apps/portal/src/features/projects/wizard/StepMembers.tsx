'use client';

import { useMemo, useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimdossier/ui';
import { Mail, Plus, Trash2, Users } from '@bimdossier/ui/icons';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useSelectableOrgMembers } from '@/features/admin/members/useSelectableOrgMembers';
import type { ProjectRole } from '@/lib/api/schemas';

import { fieldLabelClass } from './stepStyles';

// Mirrors `AddProjectMemberDialog` — `owner` is reserved for the creator and
// is never assignable here.
const ASSIGNABLE_ROLES: readonly ProjectRole[] = [
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
];

// The free tier supports only editor/viewer members (the backend rejects the
// rest), and there is no existing-org-member picker — invites only.
const FREE_ASSIGNABLE_ROLES: readonly ProjectRole[] = ['editor', 'viewer'];
const FREE_MAX_INVITES = 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One person queued to join the project once it's created — either an
 * existing org user (`org`) or an email invite for someone not yet in the
 * org (`invite`). `label` is the display string used in the list and in any
 * failure toast. */
export type PendingTeamEntry =
  | { kind: 'org'; userId: string; label: string; role: ProjectRole }
  | { kind: 'invite'; email: string; fullName: string | null; label: string; role: ProjectRole };

export type StepMembersProps = {
  organizationId: string | null;
  currentUserId: string | null;
  entries: PendingTeamEntry[];
  onAdd: (entry: PendingTeamEntry) => void;
  onRemove: (index: number) => void;
  onChangeRole: (index: number, role: ProjectRole) => void;
  /** Free workspace: email-invites only (no org picker), roles limited to
   * editor/viewer, capped at 3 invited members. */
  freeMode?: boolean;
};

export function StepMembers({
  organizationId,
  currentUserId,
  entries,
  onAdd,
  onRemove,
  onChangeRole,
  freeMode = false,
}: StepMembersProps): JSX.Element {
  const t = useTranslations('projects.wizard.members');
  const tRoles = useTranslations('projectAccess.table.roles');
  const selectableQuery = useSelectableOrgMembers(organizationId);
  const roles = freeMode ? FREE_ASSIGNABLE_ROLES : ASSIGNABLE_ROLES;
  const atInviteCap = freeMode && entries.length >= FREE_MAX_INVITES;

  const [tab, setTab] = useState<'fromOrg' | 'invite'>(freeMode ? 'invite' : 'fromOrg');
  const [userId, setUserId] = useState('');
  const [orgRole, setOrgRole] = useState<ProjectRole>('viewer');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('viewer');
  const [addError, setAddError] = useState<string | null>(null);

  const chosenUserIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.kind === 'org') set.add(e.userId);
    return set;
  }, [entries]);

  const chosenEmails = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.kind === 'invite') set.add(e.email.toLowerCase());
    return set;
  }, [entries]);

  // Candidates = active non-guest members, minus the creator (auto-owner),
  // minus org admins (auto-added as editors — adding them again would 409),
  // minus anyone already queued.
  const candidates = useMemo(() => {
    const all = selectableQuery.data ?? [];
    return all.filter(
      (m) => m.user_id !== currentUserId && !m.is_org_admin && !chosenUserIds.has(m.user_id),
    );
  }, [selectableQuery.data, currentUserId, chosenUserIds]);

  const handleAddOrg = (): void => {
    setAddError(null);
    if (userId === '') {
      setAddError(t('errors.pickUser'));
      return;
    }
    const picked = candidates.find((c) => c.user_id === userId);
    if (picked === undefined) return;
    const label = picked.full_name === null
      ? picked.email
      : `${picked.full_name} (${picked.email})`;
    onAdd({ kind: 'org', userId, label, role: orgRole });
    setUserId('');
    setOrgRole('viewer');
  };

  const handleAddInvite = (): void => {
    setAddError(null);
    if (atInviteCap) {
      setAddError(t('errors.inviteCap', { max: FREE_MAX_INVITES }));
      return;
    }
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setAddError(t('errors.invalidEmail'));
      return;
    }
    if (chosenEmails.has(trimmed.toLowerCase())) {
      setAddError(t('errors.duplicate'));
      return;
    }
    const name = fullName.trim();
    const label = name.length === 0 ? trimmed : `${name} (${trimmed})`;
    onAdd({
      kind: 'invite',
      email: trimmed,
      fullName: name.length === 0 ? null : name,
      label,
      role: inviteRole,
    });
    setEmail('');
    setFullName('');
    setInviteRole('viewer');
  };

  const noCandidates = !selectableQuery.isLoading && candidates.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body3 text-foreground-tertiary">{t('intro')}</p>

      <div className="flex flex-col gap-3 rounded-md border border-border bg-background-secondary p-3">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as 'fromOrg' | 'invite');
            setAddError(null);
          }}
        >
          {!freeMode && (
            <TabsList className="mb-3 w-full">
              <TabsTrigger value="fromOrg" className="flex-1">{t('tabs.fromOrg')}</TabsTrigger>
              <TabsTrigger value="invite" className="flex-1">{t('tabs.inviteByEmail')}</TabsTrigger>
            </TabsList>
          )}

          <ErrorBanner message={addError} className="mb-3" />

          {!freeMode && (
          <TabsContent value="fromOrg">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="team-org-user" className={fieldLabelClass}>{t('fields.user')}</Label>
                <Select
                  id="team-org-user"
                  value={userId}
                  onChange={(e) => { setUserId(e.target.value); }}
                  disabled={selectableQuery.isLoading || noCandidates}
                >
                  <option value="">{t('placeholders.user')}</option>
                  {candidates.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name === null ? m.email : `${m.full_name} (${m.email})`}
                    </option>
                  ))}
                </Select>
                {noCandidates && (
                  <p className="text-caption text-foreground-tertiary">{t('noCandidates')}</p>
                )}
                <p className="text-caption text-foreground-tertiary">{t('adminsAutoAdded')}</p>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="team-org-role" className={fieldLabelClass}>{t('fields.role')}</Label>
                  <Select
                    id="team-org-role"
                    value={orgRole}
                    onChange={(e) => { setOrgRole(e.target.value as ProjectRole); }}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>{tRoles(r)}</option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleAddOrg}
                  disabled={noCandidates}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('actions.add')}
                </Button>
              </div>
            </div>
          </TabsContent>
          )}

          <TabsContent value="invite">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="team-invite-email" className={fieldLabelClass}>{t('fields.email')}</Label>
                <Input
                  id="team-invite-email"
                  type="email"
                  placeholder={t('placeholders.email')}
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); }}
                />
                <p className="text-caption text-foreground-tertiary">{t('guestHint')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="team-invite-name" className={fieldLabelClass}>{t('fields.fullName')}</Label>
                <Input
                  id="team-invite-name"
                  type="text"
                  placeholder={t('placeholders.fullName')}
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); }}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="team-invite-role" className={fieldLabelClass}>{t('fields.role')}</Label>
                  <Select
                    id="team-invite-role"
                    value={inviteRole}
                    onChange={(e) => { setInviteRole(e.target.value as ProjectRole); }}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>{tRoles(r)}</option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleAddInvite}
                  disabled={atInviteCap}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('actions.add')}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex flex-col gap-2">
        <span className={fieldLabelClass}>{t('listHeading', { count: entries.length })}</span>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-center">
            <Users className="h-5 w-5 text-foreground-tertiary" />
            <p className="text-body3 text-foreground-tertiary">{t('emptyState')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry, index) => (
              <li
                key={entry.kind === 'org' ? `org:${entry.userId}` : `invite:${entry.email}`}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-low px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {entry.kind === 'invite' && (
                    <Mail className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden="true" />
                  )}
                  <span className="truncate text-body3 text-foreground">{entry.label}</span>
                  {entry.kind === 'invite' && (
                    <Badge variant="default">{t('inviteBadge')}</Badge>
                  )}
                </div>
                <Select
                  value={entry.role}
                  onChange={(e) => { onChangeRole(index, e.target.value as ProjectRole); }}
                  selectSize="sm"
                  className="w-36"
                  aria-label={t('fields.role')}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>{tRoles(r)}</option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => { onRemove(index); }}
                  aria-label={t('actions.remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {freeMode ? (
          <p className="text-caption text-foreground-tertiary">
            {t('pooledInviteHint', { max: FREE_MAX_INVITES })}
          </p>
        ) : (
          entries.length === 0 && (
            <p className="text-caption text-foreground-tertiary">{t('minOneHint')}</p>
          )
        )}
      </div>
    </div>
  );
}
