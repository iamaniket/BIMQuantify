'use client';

import {
  ChevronRight,
  Eye,
  LayoutGrid,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { HeroShell } from '@/components/layout/HeroShell';
import { PageShell } from '@/components/layout/PageShell';
import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { ApiError } from '@/lib/api/client';
import type { ProjectMember } from '@/lib/api/schemas';
import { useProject } from '@/features/projects/useProject';
import { AddProjectMemberDialog } from '@/features/projects/members/AddProjectMemberDialog';
import { ProjectMembersList } from '@/features/projects/members/ProjectMembersList';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useAuth } from '@/providers/AuthProvider';

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-info',
  editor: 'bg-primary',
  viewer: 'bg-foreground-tertiary',
  inspector: 'bg-warning',
  contractor: 'bg-success',
  client: 'bg-error',
};

const ALL_ROLES = ['owner', 'editor', 'viewer', 'inspector', 'contractor', 'client'] as const;

function projectInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function ProjectAccessHero({
  projectName,
  members,
}: {
  projectName: string;
  members: ProjectMember[];
}): JSX.Element {
  const t = useTranslations('projectAccess.hero');

  const distinctRoles = new Set(members.map((m) => m.role));
  const owner = members.find((m) => m.role === 'owner');

  return (
    <HeroShell
      image={
        <div className="flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-[28px] font-extrabold text-primary-foreground shadow-md">
          {projectInitials(projectName)}
        </div>
      }
      title={projectName}
      badge={
        <Badge variant="info">
          <Shield className="mr-1 h-3 w-3" />
          {t('badge')}
        </Badge>
      }
      subtitle={<span>{t('subtitle')}</span>}
      kpis={[
        {
          label: t('members'),
          value: String(members.length),
          sub: t('active'),
        },
        {
          label: t('roles'),
          value: String(distinctRoles.size),
          sub: t('distinct'),
        },
        {
          label: t('owner'),
          value: owner !== undefined ? (owner.full_name ?? owner.email.split('@')[0] ?? '—') : '—',
          sub: t('projectOwner'),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Overview pane
// ---------------------------------------------------------------------------

function OverviewPane({
  members,
  canManage,
  onAddMember,
  onSwitchTab,
}: {
  members: ProjectMember[];
  canManage: boolean;
  onAddMember: () => void;
  onSwitchTab: (tab: string) => void;
}): JSX.Element {
  const t = useTranslations('projectAccess.overview');
  const tRoles = useTranslations('projectAccess.table.roles');

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of members) {
      counts[m.role] = (counts[m.role] ?? 0) + 1;
    }
    return counts;
  }, [members]);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{t('membersByRoleTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            <div className="divide-y divide-border">
              {ALL_ROLES.filter((r) => (roleCounts[r] ?? 0) > 0).map((role) => (
                <div key={role} className="flex items-center justify-between px-5 py-2.5">
                  <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                    <span className={`h-2.5 w-2.5 rounded-sm ${ROLE_COLORS[role] ?? 'bg-foreground-tertiary'}`} />
                    {tRoles(role as 'owner')}
                  </div>
                  <div className="font-mono text-body3 text-foreground-tertiary">
                    {roleCounts[role]}{' '}
                    <span className="text-foreground-tertiary">
                      &middot; {t(`roleDesc.${role}` as 'roleDesc.owner')}
                    </span>
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div className="flex h-20 items-center justify-center text-body3 text-foreground-tertiary">
                  —
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        {canManage && (
          <Card>
            <CardHeader>
              <h3 className="text-body2 font-bold">{t('quickActionsTitle')}</h3>
            </CardHeader>
            <CardBody className="space-y-0.5 p-2">
              <button
                type="button"
                className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
                onClick={onAddMember}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-body3 font-semibold">{t('addMember')}</div>
                  <div className="text-caption text-foreground-tertiary">{t('addMemberSub')}</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
              </button>
              <button
                type="button"
                className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
                onClick={() => { onSwitchTab('members'); }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-body3 font-semibold">{t('viewAllMembers')}</div>
                  <div className="text-caption text-foreground-tertiary">{t('viewAllMembersSub')}</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
              </button>
            </CardBody>
          </Card>
        )}

        {!canManage && (
          <Card className="border-info/30">
            <CardHeader className="border-b-info/30 bg-info/5">
              <div className="flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-info" />
                <h3 className="text-body2 font-bold text-info">{t('readOnlyTitle')}</h3>
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-body3 leading-relaxed text-foreground-tertiary">
                {t('readOnlyDesc')}
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members toolbar
// ---------------------------------------------------------------------------

function MembersToolbar({
  query,
  onQueryChange,
  roleFilter,
  onRoleFilterChange,
  canManage,
  addLabel,
  onAddMember,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  canManage: boolean;
  addLabel: string;
  onAddMember: () => void;
}): JSX.Element {
  const t = useTranslations('projectAccess.toolbar');
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
        <option value="owner">{t('roleOwner')}</option>
        <option value="editor">{t('roleEditor')}</option>
        <option value="viewer">{t('roleViewer')}</option>
        <option value="inspector">{t('roleInspector')}</option>
        <option value="contractor">{t('roleContractor')}</option>
        <option value="client">{t('roleClient')}</option>
      </Select>
      <div className="flex-1" />
      {canManage && (
        <Button size="sm" onClick={onAddMember}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const tabTriggerClass =
  'relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary';

export default function ProjectAccessPage(): JSX.Element {
  const t = useTranslations('projectAccess');
  const params = useParams();
  const rawProjectId = params['projectId'];
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';

  const { me, activeMembership } = useAuth();
  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId);

  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState('overview');
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
  let isOrgAdmin = false;
  if (activeMembership !== null) {
    isOrgAdmin = activeMembership.is_org_admin;
  }

  let isSuperuser = false;
  if (me !== null) {
    isSuperuser = me.user.is_superuser;
  }

  const members = useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

  const isProjectOwner = useMemo(() => {
    if (currentUserId === null) return false;
    return members.some((m) => m.user_id === currentUserId && m.role === 'owner');
  }, [currentUserId, members]);

  const canManage = isSuperuser || isOrgAdmin || isProjectOwner;

  const filteredMembers = useMemo(() => members.filter((m) => {
    if (roleFilter !== 'all' && m.role !== roleFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const nameMatch = m.full_name !== null && m.full_name.toLowerCase().includes(q);
      const emailMatch = m.email.toLowerCase().includes(q);
      if (!nameMatch && !emailMatch) return false;
    }
    return true;
  }), [members, roleFilter, query]);

  if (projectQuery.isLoading || membersQuery.isLoading) {
    return (
      <PageShell
        hero={
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[80px] w-[80px] rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        }
      >
        <div className="p-5">
          <Skeleton className="h-64 w-full" />
        </div>
      </PageShell>
    );
  }

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

  const panelHeading = {
    overview: {
      eyebrow: t('panel.overviewEyebrow'),
      title: project.name,
      sub: '',
    },
    members: {
      eyebrow: t('panel.membersEyebrow'),
      title: t('panel.activeMembers', { count: members.length }),
      sub: '',
    },
  }[tab] ?? { eyebrow: '', title: '', sub: '' };

  let membersContent: JSX.Element;
  if (membersQuery.isError) {
    membersContent = (
      <div
        role="alert"
        className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body3 text-error"
      >
        {t('errors.membersLoadFailed')}
      </div>
    );
  } else if (members.length === 0) {
    membersContent = (
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
    );
  } else {
    membersContent = (
      <>
        <ProjectMembersList
          projectId={projectId}
          members={filteredMembers}
          canManage={canManage}
        />
        <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
          <span>
            {t('panel.showingOf', { filtered: filteredMembers.length, total: members.length })}
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
        hero={
          <ProjectAccessHero
            projectName={project.name}
            members={members}
          />
        }
      >
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
            <TabsTrigger value="overview" className={tabTriggerClass}>
              <LayoutGrid className="h-3.5 w-3.5" />
              {t('tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="members" className={tabTriggerClass}>
              <Users className="h-3.5 w-3.5" />
              {t('tabs.members')}
              <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
                {members.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
              <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary after:ml-2 after:opacity-50 after:content-['·']">
                {panelHeading.eyebrow}
              </div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <h2 className="text-body2 font-bold">{panelHeading.title}</h2>
                {panelHeading.sub !== '' && (
                  <span className="text-body3 text-foreground-tertiary before:mr-1.5 before:opacity-60 before:content-['·']">
                    {panelHeading.sub}
                  </span>
                )}
              </div>
            </div>
          </div>

          {tab === 'members' && (
            <MembersToolbar
              query={query}
              onQueryChange={setQuery}
              roleFilter={roleFilter}
              onRoleFilterChange={setRoleFilter}
              canManage={canManage}
              addLabel={t('addMember')}
              onAddMember={() => { setAddOpen(true); }}
            />
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <TabsContent value="overview" className="mt-0">
              <OverviewPane
                members={members}
                canManage={canManage}
                onAddMember={() => { setAddOpen(true); }}
                onSwitchTab={setTab}
              />
            </TabsContent>

            <TabsContent value="members" className="mt-0">
              {membersContent}
            </TabsContent>
          </div>
        </Tabs>
      </PageShell>

      {canManage && activeOrgId !== null && (
        <AddProjectMemberDialog
          projectId={projectId}
          organizationId={activeOrgId}
          existingMembers={members}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
    </>
  );
}
