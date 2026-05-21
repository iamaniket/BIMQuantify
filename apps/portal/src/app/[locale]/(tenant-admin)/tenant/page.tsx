'use client';

import {
  Activity,

  ChevronRight,
  Clock,
  Download,
  Key,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { HeroShell } from '@/components/layout/HeroShell';
import { PageShell } from '@/components/layout/PageShell';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { MembersTable } from '@/features/admin/members/MembersTable';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import type { AuditEntry, MemberRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orgInitials(name: string): string {
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

// ---------------------------------------------------------------------------
// Bento Header
// ---------------------------------------------------------------------------

function TenantHero({
  orgName,
  orgStatus,
  seatUsed,
  seatLimit,
  members,
  auditEntries,
}: {
  orgName: string;
  orgStatus: string;
  seatUsed: number;
  seatLimit: number | null;
  members: MemberRead[];
  auditEntries: AuditEntry[];
}): JSX.Element {
  const t = useTranslations('tenantAdmin.bento');

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;
  const totalActive = members.filter((m) => m.status !== 'removed').length;
  const unlimited = seatLimit === null;
  const seatPct = unlimited ? (seatUsed > 0 ? 8 : 0) : Math.round((seatUsed / seatLimit) * 100);

  const lastEvent: AuditEntry | null = auditEntries.length > 0 ? auditEntries[0] ?? null : null;
  const todayCount = auditEntries.filter((e) => {
    const d = new Date(e.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <HeroShell
      image={
        <div className="flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-[28px] font-extrabold text-primary-foreground shadow-md">
          {orgInitials(orgName)}
        </div>
      }
      title={orgName}
      badge={
        <Badge variant={orgStatus === 'active' ? 'success' : 'warning'}>
          {orgStatus === 'active' ? 'Active' : 'Suspended'}
        </Badge>
      }
      subtitle={
        <>
          <span>{t('members')}, {t('seats').toLowerCase()}, audit</span>
          <span className="text-foreground-tertiary/50">·</span>
          <span>
            <strong className="text-primary">{adminCount}</strong> {t('admin')}
            {' · '}
            <strong className="text-foreground-secondary">{memberCount}</strong> {t('member')}
            {pendingCount > 0 && (
              <> · {t('pendingInvite', { count: pendingCount })}</>
            )}
          </span>
        </>
      }
      kpis={[
        {
          label: t('seats'),
          value: `${seatUsed}`,
          sub: (
            <div className="flex flex-col gap-1">
              <span>/ {unlimited ? '∞' : seatLimit}</span>
              <div className="h-1 w-16 overflow-hidden rounded-full bg-background-hover">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
                  style={{ width: `${Math.min(seatPct, 100)}%` }}
                />
              </div>
            </div>
          ),
        },
        {
          label: t('members'),
          value: String(totalActive),
          sub: `${t('total')}`,
        },
        {
          label: t('lastActivity'),
          value: lastEvent !== null ? relativeTime(lastEvent.created_at) : '—',
          sub: lastEvent !== null ? lastEvent.action : t('noEvents'),
        },
        {
          label: t('eventsToday', { count: todayCount }),
          value: String(todayCount),
          sub: (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              today
            </span>
          ),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Overview Pane
// ---------------------------------------------------------------------------

function OverviewPane({
  orgName,
  seatUsed,
  seatLimit,
  members,
  auditEntries,
  onInvite,
  onSwitchTab,
}: {
  orgName: string;
  seatUsed: number;
  seatLimit: number | null;
  members: MemberRead[];
  auditEntries: AuditEntry[];
  onInvite: () => void;
  onSwitchTab: (tab: string) => void;
}): JSX.Element {
  const t = useTranslations('tenantAdmin.overview');
  const unlimited = seatLimit === null;
  const gridTotal = 20;
  const cells = Array.from({ length: gridTotal }, (_, i) => (i < seatUsed ? 'used' : 'available'));

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  const recentEvents = auditEntries.slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Left column */}
      <div className="flex flex-col gap-5">
        {/* Seat usage card */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-body2 font-bold">{t('seatUsageTitle')}</h3>
            <Badge variant="info">
              <Key className="mr-1 h-3 w-3" />
              {unlimited ? t('unlimited') : `${seatLimit} seats`}
            </Badge>
          </CardHeader>
          <CardBody>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-h4 font-extrabold tracking-tight">
                {seatUsed}
                <span className="ml-1 text-body1 font-medium text-foreground-tertiary">
                  {t('seatsInUse', { count: seatUsed })}
                </span>
              </div>
              <div className="text-body3 text-foreground-tertiary">
                {t('showingOf', { shown: gridTotal, total: unlimited ? '∞' : String(seatLimit) })}
              </div>
            </div>
            <div className="grid grid-cols-[repeat(20,1fr)] gap-1.5">
              {cells.map((c, i) => (
                <div
                  key={i}
                  className={
                    c === 'used'
                      ? 'aspect-square rounded-sm bg-gradient-to-br from-primary to-primary-light shadow-[inset_0_0_0_1px_rgba(44,86,151,0.25)]'
                      : unlimited
                        ? 'aspect-square rounded-sm bg-[repeating-linear-gradient(45deg,var(--background-tertiary)_0,var(--background-tertiary)_3px,var(--background-hover)_3px,var(--background-hover)_6px)]'
                        : 'aspect-square rounded-sm bg-background-hover'
                  }
                />
              ))}
            </div>
            <div className="mt-3.5 flex gap-4 text-body3 text-foreground-tertiary">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-br from-primary to-primary-light" />
                {t('assigned')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-background-hover" />
                {unlimited ? t('availableUnlimited') : t('available')}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Recent activity card */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-body2 font-bold">{t('recentActivityTitle')}</h3>
            <button
              type="button"
              className="text-body3 font-semibold text-primary hover:underline"
              onClick={() => { onSwitchTab('audit'); }}
            >
              {t('viewAuditLog')} →
            </button>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            {recentEvents.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-body3 text-foreground-tertiary">
                No recent activity
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentEvents.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[28px_1fr_auto] items-start gap-3 px-5 py-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                      {entry.action.startsWith('auth.') ? (
                        <Shield className="h-3.5 w-3.5" />
                      ) : entry.action.includes('invite') || entry.action.includes('member') ? (
                        <UserPlus className="h-3.5 w-3.5" />
                      ) : (
                        <Settings className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="text-body3 text-foreground-secondary">
                      <span className="font-semibold text-foreground">
                        {entry.resource_type}
                      </span>{' '}
                      <span className="text-foreground-tertiary">{entry.action}</span>
                    </div>
                    <div className="font-mono text-body3 text-foreground-tertiary">
                      {relativeTime(entry.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-5">
        {/* Members by role */}
        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{t('membersByRoleTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0 p-0">
            <div className="divide-y divide-border">
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                  <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                  Admin
                </div>
                <div className="font-mono text-body3 text-foreground-tertiary">
                  {adminCount} <span className="text-foreground-tertiary">· {t('fullAccess')}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                  <span className="h-2.5 w-2.5 rounded-sm bg-foreground-tertiary" />
                  Member
                </div>
                <div className="font-mono text-body3 text-foreground-tertiary">
                  {memberCount} <span className="text-foreground-tertiary">· {t('readWrite')}</span>
                </div>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <div className="flex items-center gap-2.5 text-body3 font-medium text-warning">
                    <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
                    {t('pendingInvite')}
                  </div>
                  <div className="font-mono text-body3 text-foreground-tertiary">{pendingCount}</div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <h3 className="text-body2 font-bold">{t('quickActionsTitle')}</h3>
          </CardHeader>
          <CardBody className="space-y-0.5 p-2">
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
              onClick={onInvite}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <UserPlus className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{t('inviteMember')}</div>
                <div className="text-caption text-foreground-tertiary">{t('inviteMemberSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
            <button
              type="button"
              className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
                <Download className="h-4 w-4" />
              </div>
              <div>
                <div className="text-body3 font-semibold">{t('exportData')}</div>
                <div className="text-caption text-foreground-tertiary">{t('exportDataSub')}</div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
            </button>
          </CardBody>
        </Card>

        {/* Danger zone */}
        <Card className="border-error-light">
          <CardHeader className="border-b-error-light bg-error-lighter">
            <div className="flex items-center justify-between">
              <h3 className="text-body2 font-bold text-error">{t('dangerZoneTitle')}</h3>
              <Trash2 className="h-3.5 w-3.5 text-error" />
            </div>
          </CardHeader>
          <CardBody>
            <p className="mb-3.5 text-body3 leading-relaxed text-foreground-tertiary">
              {t('dangerZoneDesc')}
            </p>
            <Button
              variant="border"
              size="sm"
              className="border-error-light text-error hover:bg-error-lighter"
            >
              {t('deleteOrg')}
            </Button>
          </CardBody>
        </Card>
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
  statusFilter,
  onStatusFilterChange,
  onInvite,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  onInvite: () => void;
}): JSX.Element {
  const t = useTranslations('tenantAdmin.toolbar');

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
        <option value="admin">{t('roleAdmin')}</option>
        <option value="member">{t('roleMember')}</option>
      </Select>
      <Select selectSize="sm" value={statusFilter} onChange={(e) => { onStatusFilterChange(e.target.value); }}>
        <option value="all">{t('statusAll')}</option>
        <option value="active">{t('statusActive')}</option>
        <option value="pending">{t('statusPending')}</option>
        <option value="suspended">{t('statusSuspended')}</option>
      </Select>
      <div className="flex-1" />
      <Button size="sm" onClick={onInvite}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Invite member
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit toolbar
// ---------------------------------------------------------------------------

function AuditToolbar(): JSX.Element {
  const t = useTranslations('tenantAdmin.toolbar');
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <Select selectSize="sm" defaultValue="7">
        <option value="today">{t('dateToday')}</option>
        <option value="7">{t('date7')}</option>
        <option value="30">{t('date30')}</option>
        <option value="all">{t('dateAll')}</option>
      </Select>
      <Select selectSize="sm" defaultValue="all">
        <option value="all">{t('actionAll')}</option>
        <option value="auth">auth.*</option>
        <option value="member">member.*</option>
        <option value="settings">settings.*</option>
      </Select>
      <div className="flex-1" />
      <Button variant="border" size="sm">
        <Download className="mr-1 h-3.5 w-3.5" />
        {t('exportCsv')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TenantAdminPage(): JSX.Element {
  const t = useTranslations('tenantAdmin');
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? null;

  const membersQuery = useOrgMembers(organizationId ?? '', {});
  const auditQuery = useOrgAuditLog(organizationId ?? '', { limit: 50 });

  const members = membersQuery.data ?? [];
  const auditEntries = auditQuery.data ?? [];

  const crumbs = useMemo(
    () => (activeMembership === null
      ? null
      : [
        { label: t('crumb'), href: undefined },
        { label: activeMembership.organization_name, href: undefined },
      ]),
    [activeMembership, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState('members');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  if (activeMembership === null || organizationId === null) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="px-6 py-6">
          <Skeleton className="mb-6 h-10 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (!activeMembership.is_org_admin) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="px-6 py-6">
          <p className="text-body3 text-error">{t('notAdmin')}</p>
        </div>
      </main>
    );
  }

  // Client-side member filtering
  const filteredMembers = members.filter((m) => {
    if (roleFilter === 'admin' && !m.is_org_admin) return false;
    if (roleFilter === 'member' && m.is_org_admin) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const nameMatch = m.full_name !== null && m.full_name.toLowerCase().includes(q);
      const emailMatch = m.email.toLowerCase().includes(q);
      if (!nameMatch && !emailMatch) return false;
    }
    return true;
  });

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  // Panel header content per tab
  const panelHeading = {
    overview: {
      eyebrow: t('panel.overviewEyebrow'),
      title: activeMembership.organization_name,
      sub: '',
    },
    members: {
      eyebrow: t('panel.membersEyebrow'),
      title: t('panel.activeMembers', { count: activeCount }),
      sub: pendingCount > 0 ? t('panel.pendingShort', { count: pendingCount }) : '',
    },
    audit: {
      eyebrow: t('panel.auditEyebrow'),
      title: t('panel.recentEvents', { count: auditEntries.length }),
      sub: t('panel.lastDays', { days: 7 }),
    },
  }[tab] ?? { eyebrow: '', title: '', sub: '' };

  return (
    <PageShell
      hero={
        <TenantHero
          orgName={activeMembership.organization_name}
          orgStatus={activeMembership.organization_status}
          seatUsed={activeMembership.seat_count_used}
          seatLimit={activeMembership.seat_limit}
          members={members}
          auditEntries={auditEntries}
        />
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Underline tabs */}
        <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
          <TabsTrigger
            value="overview"
            className="relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger
            value="members"
            className="relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary"
          >
            <Users className="h-3.5 w-3.5" />
            {t('tabs.members')}
            <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
              {members.length}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="audit"
            className="relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary"
          >
            <Activity className="h-3.5 w-3.5" />
            {t('tabs.audit')}
            <span className="rounded-full bg-background-hover px-1.5 py-px text-caption font-bold text-foreground-tertiary">
              {auditEntries.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Panel header — eyebrow + title */}
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
          {tab === 'overview' && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-body3 font-semibold text-primary hover:underline"
            >
              <Settings className="h-3.5 w-3.5" />
              {t('panel.manageSettings')}
            </button>
          )}
        </div>

        {/* Tab-specific toolbar */}
        {tab === 'members' && (
          <MembersToolbar
            query={query}
            onQueryChange={setQuery}
            roleFilter={roleFilter}
            onRoleFilterChange={setRoleFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onInvite={() => { setInviteOpen(true); }}
          />
        )}
        {tab === 'audit' && <AuditToolbar />}

        {/* Scrollable tab content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="overview" className="mt-0">
            {membersQuery.isLoading || auditQuery.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <OverviewPane
                orgName={activeMembership.organization_name}
                seatUsed={activeMembership.seat_count_used}
                seatLimit={activeMembership.seat_limit}
                members={members}
                auditEntries={auditEntries}
                onInvite={() => { setInviteOpen(true); }}
                onSwitchTab={setTab}
              />
            )}
          </TabsContent>

          <TabsContent value="members" className="mt-0">
            {membersQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : membersQuery.isError ? (
              <p className="text-body3 text-error">{t('members.loadError')}</p>
            ) : (
              <>
                <MembersTable
                  organizationId={organizationId}
                  members={filteredMembers}
                />
                <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
                  <span>
                    {t('members.showing', { filtered: filteredMembers.length, total: members.length })}
                  </span>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="audit" className="mt-0">
            {auditQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : auditQuery.isError ? (
              <p className="text-body3 text-error">{t('audit.loadError')}</p>
            ) : (
              <>
                <AuditLogTable entries={auditEntries} />
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-body3 text-foreground-tertiary">
                  <span>{t('audit.eventCount', { count: auditEntries.length })}</span>
                  <button type="button" className="font-semibold text-primary hover:underline">
                    {t('audit.loadOlder')} →
                  </button>
                </div>
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <InviteMemberDialog
        organizationId={organizationId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </PageShell>
  );
}
