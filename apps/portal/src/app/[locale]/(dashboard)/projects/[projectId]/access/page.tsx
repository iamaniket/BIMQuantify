'use client';

import { ChevronRight, Eye, LayoutGrid, Plus, Search, Shield, UserPlus, Users } from '@bimdossier/ui/icons';
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
  TabsContent,
} from '@bimdossier/ui';
import { ErrorBanner } from '@/components/shared/ErrorBanner';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { ApiError } from '@/lib/api/client';
import { useClientPagination } from '@/lib/query/useTableQuery';
import type { ProjectMember } from '@/lib/api/schemas';
import { useProject } from '@/features/projects/useProject';
import { AddProjectMemberDialog } from '@/features/projects/members/AddProjectMemberDialog';
import { ProjectMembersList } from '@/features/projects/members/ProjectMembersList';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useProjectPermissions } from '@/features/permissions';
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
        <HeroImage>
          <span className="text-[28px] font-extrabold text-primary-foreground">
            {projectInitials(projectName)}
          </span>
        </HeroImage>
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
                  <div className="font-sans text-body3 text-foreground-tertiary">
                    {roleCounts[role]}{' '}
                    <span className="text-foreground-tertiary">
                      &middot; {t(`roleDesc.${role}` as 'roleDesc.owner')}
                    </span>
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
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
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
      <div className="relative min-w-0 w-full sm:w-auto sm:min-w-[260px]">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
        <Input
          inputSize="md"
          className="pl-9"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
        />
      </div>
      <Select selectSize="md" value={roleFilter} onChange={(e) => { onRoleFilterChange(e.target.value); }}>
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
        <Button size="md" onClick={onAddMember}>
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


export default function ProjectAccessPage(): JSX.Element {
  const t = useTranslations('projectAccess');
  const t2 = useTranslations();
  const tTable = useTranslations('common.table');
  const params = useParams();
  const rawProjectId = params['projectId'];
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';

  const { activeMembership } = useAuth();
  const { canManageMembers: canManage } = useProjectPermissions(projectId);
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
        { label: t2('breadcrumbs.projects'), href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t, t2],
  );
  useHeaderCrumbsOverride(crumbs);

  const members = useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

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

  const membersTable = useClientPagination(filteredMembers, {
    sortAccessors: {
      name: (m) => m.full_name ?? m.email,
      role: (m) => m.role,
      added: (m) => m.created_at,
    },
    initialSort: { key: 'name', dir: 'asc' },
    isLoading: membersQuery.isLoading,
    isError: membersQuery.isError,
  });

  if (projectQuery.isLoading || membersQuery.isLoading) {
    return (
      <PageShell
        hero={
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[112px] w-[160px] rounded-[10px]" />
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
        <ErrorBanner message={isNotFound ? t('errors.notFound') : t('errors.loadFailed')} tone="soft" className="text-body2" />
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
      <div className="p-5">
        <ErrorBanner message={t('errors.membersLoadFailed')} tone="soft" />
      </div>
    );
  } else if (members.length === 0) {
    membersContent = (
      <div className="grid min-h-0 flex-1 place-items-center p-5">
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
      </div>
    );
  } else {
    membersContent = (
      <>
        <ProjectMembersList
          projectId={projectId}
          table={membersTable}
          canManage={canManage}
          emptyMessage={tTable('noResults')}
          loadError={t('errors.membersLoadFailed')}
        />
        <TablePaginationFooter
          table={membersTable}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </>
    );
  }

  return (
    <TabbedPageShell
      hero={
        <ProjectAccessHero
          projectName={project.name}
          members={members}
        />
      }
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'members',
          label: t('tabs.members'),
          icon: <Users className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{members.length}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'members'}
      toolbar={
        tab === 'members' ? (
          <MembersToolbar
            query={query}
            onQueryChange={setQuery}
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            canManage={canManage}
            addLabel={t('addMember')}
            onAddMember={() => { setAddOpen(true); }}
          />
        ) : undefined
      }
      afterTabs={
        canManage && activeOrgId !== null ? (
          <AddProjectMemberDialog
            projectId={projectId}
            organizationId={activeOrgId}
            existingMembers={members}
            open={addOpen}
            onOpenChange={setAddOpen}
          />
        ) : undefined
      }
    >
      <TabsContent value="overview" className="mt-0">
        <OverviewPane
          members={members}
          canManage={canManage}
          onAddMember={() => { setAddOpen(true); }}
          onSwitchTab={setTab}
        />
      </TabsContent>

      <TabsContent value="members" className="mt-0 flex min-h-0 flex-1 flex-col">
        {membersContent}
      </TabsContent>
    </TabbedPageShell>
  );
}
