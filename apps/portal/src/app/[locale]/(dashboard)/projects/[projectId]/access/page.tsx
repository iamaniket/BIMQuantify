'use client';

import { Plus, Search, UserPlus, Users } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Button, EmptyState, Input, Select, Skeleton } from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { HeroShell } from '@/components/layout/HeroShell';
import { PageShell } from '@/components/layout/PageShell';
import { ApiError } from '@/lib/api/client';
import type { ProjectMember } from '@/lib/api/schemas';
import { useProject } from '@/features/projects/useProject';
import { AddProjectMemberDialog } from '@/features/projects/members/AddProjectMemberDialog';
import { ProjectMembersTable } from '@/features/projects/members/ProjectMembersTable';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useAuth } from '@/providers/AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const ROLE_ORDER = ['owner', 'editor', 'viewer', 'inspector', 'contractor', 'client'] as const;

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function AccessToolbar({
  query,
  onQueryChange,
  roleFilter,
  onRoleFilterChange,
  canManage,
  onAdd,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  canManage: boolean;
  onAdd: () => void;
}): JSX.Element {
  const t = useTranslations('projectAccess.toolbar');
  const tRoles = useTranslations('projectAccess.table.roles');

  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <div className="relative min-w-[260px]">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
        <Input
          inputSize="sm"
          className="pl-9"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
        />
      </div>
      <Select selectSize="sm" value={roleFilter} onChange={(e) => { onRoleFilterChange(e.target.value); }}>
        <option value="all">{t('roleAll')}</option>
        {ROLE_ORDER.map((r) => (
          <option key={r} value={r}>{tRoles(r)}</option>
        ))}
      </Select>
      <div className="flex-1" />
      {canManage && (
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {useTranslations('projectAccess')('addMember')}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectAccessPage(): JSX.Element {
  const t = useTranslations('projectAccess');
  const tHero = useTranslations('projectAccess.hero');
  const tPanel = useTranslations('projectAccess.panel');
  const tTable = useTranslations('projectAccess.table');
  const params = useParams();
  const rawProjectId = params['projectId'];
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';

  const { me, activeMembership } = useAuth();
  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId) as UseQueryResult<ProjectMember[]>;

  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const projectName = projectQuery.data?.name;
  const crumbs = useMemo(
    () => (projectName === undefined
      ? null
      : [
        { label: 'Projects', href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const currentUserId = me === null ? null : me.user.id;
  const isOrgAdmin = activeMembership !== null && activeMembership.is_org_admin;
  const isSuperuser = me !== null && me.user.is_superuser;
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  const isProjectOwner = useMemo(() => {
    if (currentUserId === null) return false;
    return members.some((m) => m.user_id === currentUserId && m.role === 'owner');
  }, [currentUserId, members]);

  const canManage = isSuperuser || isOrgAdmin || isProjectOwner;

  // Client-side filtering
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        const nameMatch = m.full_name !== null && m.full_name.toLowerCase().includes(q);
        const emailMatch = m.email.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch) return false;
      }
      return true;
    });
  }, [members, roleFilter, query]);

  // Hero stats
  const owner = members.find((m) => m.role === 'owner');
  const distinctRoles = new Set(members.map((m) => m.role)).size;
  const lastAdded = members.length > 0
    ? members.reduce((latest, m) =>
        new Date(m.created_at) > new Date(latest.created_at) ? m : latest,
      )
    : null;

  // Loading
  if (projectQuery.isLoading || membersQuery.isLoading) {
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  // Error
  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {isNotFound ? t('errors.notFound') : t('errors.loadFailed')}
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  const activeOrgId = activeMembership === null ? null : activeMembership.organization_id;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  // Role breakdown for subtitle
  const roleCounts = new Map<string, number>();
  for (const m of members) {
    roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);
  }
  const subtitleParts = ROLE_ORDER
    .filter((r) => (roleCounts.get(r) ?? 0) > 0)
    .map((r) => `${roleCounts.get(r)} ${tTable(`roles.${r}` as 'roles.owner')}`);

  return (
    <PageShell
      hero={
        <HeroShell
          image={
            <div className="flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-[28px] font-extrabold text-primary-foreground shadow-md">
              {projectInitials(project.name)}
            </div>
          }
          title={project.name}
          badge={<Badge variant="info">{tHero('badge')}</Badge>}
          subtitle={
            subtitleParts.length > 0 ? (
              <span>{subtitleParts.join(' · ')}</span>
            ) : undefined
          }
          kpis={[
            {
              label: tHero('members'),
              value: String(members.length),
              sub: t('subtitle'),
            },
            {
              label: tHero('owner'),
              value: owner !== undefined ? (owner.full_name ?? owner.email.split('@')[0] ?? '—') : tHero('noOwner'),
            },
            {
              label: tHero('roles'),
              value: String(distinctRoles),
              sub: `of ${ROLE_ORDER.length}`,
            },
            {
              label: tHero('lastAdded'),
              value: lastAdded !== null ? relativeTime(lastAdded.created_at) : tHero('never'),
              sub: lastAdded !== null ? (lastAdded.full_name ?? lastAdded.email) : undefined,
            },
          ]}
        />
      }
    >
      {/* Panel heading */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
          <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary after:ml-2 after:opacity-50 after:content-['·']">
            {tPanel('eyebrow')}
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-body2 font-bold">{tPanel('memberCount', { count: members.length })}</h2>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <AccessToolbar
        query={query}
        onQueryChange={setQuery}
        roleFilter={roleFilter}
        onRoleFilterChange={setRoleFilter}
        canManage={canManage}
        onAdd={() => { setAddOpen(true); }}
      />

      {/* Read-only notice */}
      {!canManage && (
        <div
          className="mx-5 mt-4 rounded-md border border-border bg-surface-low px-3 py-2 text-body3 text-foreground-secondary"
          role="status"
        >
          {t('readOnlyNotice')}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {membersQuery.isError ? (
          <div
            role="alert"
            className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body3 text-error"
          >
            {t('errors.membersLoadFailed')}
          </div>
        ) : members.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title={t('emptyState.title')}
            description={t('emptyState.description')}
            action={canManage ? (
              <Button onClick={() => { setAddOpen(true); }}>
                <UserPlus className="mr-1.5 h-4 w-4" />
                {t('addMember')}
              </Button>
            ) : undefined}
            className={undefined}
          />
        ) : (
          <>
            <ProjectMembersTable
              projectId={projectId}
              members={filteredMembers}
              canManage={canManage}
            />
            {filteredMembers.length !== members.length && (
              <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
                <span>
                  {tTable('showing', { filtered: filteredMembers.length, total: members.length })}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {canManage && activeOrgId !== null && (
        <AddProjectMemberDialog
          projectId={projectId}
          organizationId={activeOrgId}
          existingMembers={members}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
    </PageShell>
  );
}
