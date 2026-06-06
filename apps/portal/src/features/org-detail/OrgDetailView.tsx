'use client';

import { Activity, Bell, Camera, ChevronRight, Clock, Download, Key, LayoutGrid, Plus, Search, Settings, Shield, Trash2, UserPlus, Users, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useMemo, useState, type JSX, type ReactNode } from 'react';

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

import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { MembersTable } from '@/features/admin/members/MembersTable';
import { DeadlineNotificationDefaults } from '@/features/admin/notifications/DeadlineNotificationDefaults';
import type { AuditEntry, MemberRead } from '@/lib/api/schemas';

import type { OrgDetailViewProps } from './types';

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

const AUDIT_PAGE_SIZE = 50;

function computeSince(filter: string): string | undefined {
  if (filter === 'all') return undefined;
  const now = new Date();
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  const days = parseInt(filter, 10);
  if (isNaN(days)) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function matchesActionFilter(action: string, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'auth') return action.startsWith('auth.');
  if (filter === 'member')
    return action.startsWith('organization_member.') || action.startsWith('member.');
  if (filter === 'settings')
    return action.startsWith('organization.') && !action.startsWith('organization_member.');
  return true;
}

function summarizeCsv(entry: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }): string {
  const before = entry.before === null ? null : JSON.stringify(entry.before);
  const after = entry.after === null ? null : JSON.stringify(entry.after);
  if (before !== null && after !== null) return `${before} → ${after}`;
  if (after !== null) return after;
  if (before !== null) return before;
  return '';
}

function exportAuditCsv(entries: AuditEntry[]): void {
  const header = 'Timestamp,Action,Resource Type,Resource ID,Change';
  const rows = entries.map((e) => {
    const ts = new Date(e.created_at).toISOString();
    const change = summarizeCsv(e).replace(/"/g, '""');
    const resId = e.resource_id ?? '';
    return `"${ts}","${e.action}","${e.resource_type}","${resId}","${change}"`;
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
// Hero
// ---------------------------------------------------------------------------

const IMAGE_ALLOWED_TYPES = 'image/png,image/jpeg,image/webp';
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

function OrgDetailHero({
  org,
  members,
  auditEntries,
  actions,
  onImageUpload,
  onImageRemove,
}: {
  org: OrgDetailViewProps['org'];
  members: MemberRead[];
  auditEntries: AuditEntry[];
  actions?: ReactNode;
  onImageUpload?: (file: File) => void;
  onImageRemove?: () => void;
}): JSX.Element {
  const t = useTranslations('orgDetail.hero');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canEdit = onImageUpload !== undefined;

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;
  const totalActive = members.filter((m) => m.status !== 'removed').length;
  const unlimited = org.seatLimit === null;
  const seatPct = org.seatLimit === null ? (org.seatCountUsed > 0 ? 8 : 0) : Math.round((org.seatCountUsed / org.seatLimit) * 100);

  const lastEvent: AuditEntry | null = auditEntries.length > 0 ? auditEntries[0] ?? null : null;
  const todayCount = auditEntries.filter((e) => {
    const d = new Date(e.created_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <HeroShell
      image={
        <div className="group relative h-[140px] w-[200px] overflow-hidden rounded-[10px] bg-black/5 shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:bg-white/10 dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
          {org.imageUrl ? (
            <img
              src={org.imageUrl}
              alt={org.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-primary-light text-[36px] font-extrabold text-primary-foreground">
              {orgInitials(org.name)}
            </div>
          )}
          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ALLOWED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > IMAGE_MAX_BYTES) return;
                  onImageUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center rounded-[10px] bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => fileInputRef.current?.click()}
                aria-label={org.imageUrl ? t('changeImage') : t('uploadImage')}
              >
                <Camera className="h-6 w-6 text-white" />
              </button>
              {org.imageUrl && onImageRemove && (
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
                  onClick={onImageRemove}
                  aria-label={t('removeImage')}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          )}
        </div>
      }
      title={org.name}
      badge={
        <Badge variant={org.status === 'active' ? 'success' : 'warning'}>
          {org.status === 'active' ? 'Active' : 'Suspended'}
        </Badge>
      }
      subtitle={
        <>
          <span>{t('members')}, {t('seats').toLowerCase()}, audit</span>
          <span className="text-foreground-tertiary/50">&middot;</span>
          <span>
            <strong className="text-primary">{adminCount}</strong> {t('admin')}
            {' · '}
            <strong className="text-foreground-secondary">{memberCount}</strong> {t('member')}
            {pendingCount > 0 && (
              <> &middot; {t('pendingInvite', { count: pendingCount })}</>
            )}
          </span>
        </>
      }
      kpis={[
        {
          label: t('seats'),
          value: `${org.seatCountUsed}`,
          sub: (
            <div className="flex flex-col gap-1">
              <span>/ {unlimited ? '∞' : org.seatLimit}</span>
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
              {t('today')}
            </span>
          ),
        },
      ]}
      action={actions}
    />
  );
}

// ---------------------------------------------------------------------------
// Overview pane
// ---------------------------------------------------------------------------

function OverviewPane({
  org,
  members,
  auditEntries,
  onInvite,
  onSwitchTab,
  extraQuickActions,
  onDelete,
}: {
  org: OrgDetailViewProps['org'];
  members: MemberRead[];
  auditEntries: AuditEntry[];
  onInvite: () => void;
  onSwitchTab: (tab: string) => void;
  extraQuickActions?: ReactNode;
  onDelete?: (() => void) | undefined;
}): JSX.Element {
  const t = useTranslations('orgDetail.overview');
  const unlimited = org.seatLimit === null;
  const gridTotal = 20;
  const cells = Array.from({ length: gridTotal }, (_, i) => (i < org.seatCountUsed ? 'used' : 'available'));

  const adminCount = members.filter((m) => m.is_org_admin && m.status === 'active').length;
  const memberCount = members.filter((m) => !m.is_org_admin && m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  const recentEvents = auditEntries.slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-body2 font-bold">{t('seatUsageTitle')}</h3>
            <Badge variant="info">
              <Key className="mr-1 h-3 w-3" />
              {unlimited ? t('unlimited') : `${org.seatLimit} seats`}
            </Badge>
          </CardHeader>
          <CardBody>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="text-h4 font-extrabold tracking-tight">
                {org.seatCountUsed}
                <span className="ml-1 text-body1 font-medium text-foreground-tertiary">
                  {t('seatsInUse', { count: org.seatCountUsed })}
                </span>
              </div>
              <div className="text-body3 text-foreground-tertiary">
                {t('showingOf', { shown: gridTotal, total: unlimited ? '∞' : String(org.seatLimit) })}
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
                      <span className="font-semibold text-foreground">{entry.resource_type}</span>{' '}
                      <span className="text-foreground-tertiary">{entry.action}</span>
                    </div>
                    <div className="font-sans text-body3 text-foreground-tertiary">
                      {relativeTime(entry.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
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
                <div className="font-sans text-body3 text-foreground-tertiary">
                  {adminCount} <span className="text-foreground-tertiary">&middot; {t('fullAccess')}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                  <span className="h-2.5 w-2.5 rounded-sm bg-foreground-tertiary" />
                  Member
                </div>
                <div className="font-sans text-body3 text-foreground-tertiary">
                  {memberCount} <span className="text-foreground-tertiary">&middot; {t('readWrite')}</span>
                </div>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <div className="flex items-center gap-2.5 text-body3 font-medium text-warning">
                    <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
                    {t('pendingInvite')}
                  </div>
                  <div className="font-sans text-body3 text-foreground-tertiary">{pendingCount}</div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

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
            {extraQuickActions}
          </CardBody>
        </Card>

        {onDelete !== undefined && (
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
                onClick={onDelete}
              >
                {t('deleteOrg')}
              </Button>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbars
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
  const t = useTranslations('orgDetail.toolbar');
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
      <Button size="sm" className="whitespace-nowrap" onClick={onInvite}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('inviteButton')}
      </Button>
    </div>
  );
}

function AuditToolbar({
  dateFilter,
  onDateFilterChange,
  actionFilter,
  onActionFilterChange,
  onExportCsv,
}: {
  dateFilter: string;
  onDateFilterChange: (v: string) => void;
  actionFilter: string;
  onActionFilterChange: (v: string) => void;
  onExportCsv: () => void;
}): JSX.Element {
  const t = useTranslations('orgDetail.toolbar');
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <Select selectSize="sm" value={dateFilter} onChange={(e) => { onDateFilterChange(e.target.value); }}>
        <option value="today">{t('dateToday')}</option>
        <option value="7">{t('date7')}</option>
        <option value="30">{t('date30')}</option>
        <option value="all">{t('dateAll')}</option>
      </Select>
      <Select selectSize="sm" value={actionFilter} onChange={(e) => { onActionFilterChange(e.target.value); }}>
        <option value="all">{t('actionAll')}</option>
        <option value="auth">auth.*</option>
        <option value="member">member.*</option>
        <option value="settings">settings.*</option>
      </Select>
      <div className="flex-1" />
      <Button variant="primary" size="sm" className="whitespace-nowrap" onClick={onExportCsv}>
        <Download className="mr-1 h-3.5 w-3.5" />
        {t('exportCsv')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function OrgDetailView({
  org,
  members,
  membersLoading,
  membersError,
  auditEntries,
  auditLoading,
  auditError,
  onInvite,
  heroActions,
  tabBarActions,
  overviewQuickActions,
  onDelete,
  onImageUpload,
  onImageRemove,
}: OrgDetailViewProps): JSX.Element {
  const t = useTranslations('orgDetail');

  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Audit filter + pagination state
  const [dateFilter, setDateFilter] = useState('7');
  const [actionFilter, setActionFilter] = useState('all');
  const [auditLimit, setAuditLimit] = useState(AUDIT_PAGE_SIZE);

  const auditSince = useMemo(() => computeSince(dateFilter), [dateFilter]);

  const internalAuditQuery = useOrgAuditLog(org.id, {
    since: auditSince,
    limit: auditLimit,
  });

  const internalAuditEntries = internalAuditQuery.data ?? [];

  const filteredAuditEntries = useMemo(
    () => internalAuditEntries.filter((e) => matchesActionFilter(e.action, actionFilter)),
    [internalAuditEntries, actionFilter],
  );

  const hasMoreAudit = internalAuditEntries.length >= auditLimit;

  const handleDateFilterChange = useCallback((v: string) => {
    setDateFilter(v);
    setAuditLimit(AUDIT_PAGE_SIZE);
  }, []);

  const handleLoadOlder = useCallback(() => {
    setAuditLimit((prev) => Math.min(prev + AUDIT_PAGE_SIZE, 500));
  }, []);

  const handleExportCsv = useCallback(() => {
    exportAuditCsv(filteredAuditEntries);
  }, [filteredAuditEntries]);

  const filteredMembers = useMemo(() => members.filter((m) => {
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
  }), [members, roleFilter, statusFilter, query]);

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  const panelHeading = {
    overview: {
      eyebrow: t('panel.overviewEyebrow'),
      title: org.name,
      sub: '',
    },
    members: {
      eyebrow: t('panel.membersEyebrow'),
      title: t('panel.activeMembers', { count: activeCount }),
      sub: pendingCount > 0 ? t('panel.pendingShort', { count: pendingCount }) : '',
    },
    audit: {
      eyebrow: t('panel.auditEyebrow'),
      title: t('panel.recentEvents', { count: filteredAuditEntries.length }),
      sub: t(`audit.period.${dateFilter}`),
    },
    notifications: {
      eyebrow: t('panel.notificationsEyebrow'),
      title: t('panel.notificationsTitle'),
      sub: '',
    },
  }[tab] ?? { eyebrow: '', title: '', sub: '' };

  const tabTriggerClass =
    'relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary';

  return (
    <PageShell
      hero={
        <OrgDetailHero
          org={org}
          members={members}
          auditEntries={auditEntries}
          actions={heroActions}
          {...(onImageUpload !== undefined ? { onImageUpload } : {})}
          {...(onImageRemove !== undefined ? { onImageRemove } : {})}
        />
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center border-b border-border bg-surface-main px-5">
          <TabsList className="min-w-0 flex-1 gap-1 rounded-none border-b-0 bg-transparent p-0">
            <TabsTrigger value="overview" className={tabTriggerClass}>
              <LayoutGrid className="h-[18px] w-[18px]" />
              {t('tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="members" className={tabTriggerClass}>
              <Users className="h-[18px] w-[18px]" />
              {t('tabs.members')}
              <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
                {members.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="audit" className={tabTriggerClass}>
              <Activity className="h-[18px] w-[18px]" />
              {t('tabs.audit')}
              <span className="rounded-full bg-background-hover px-1.5 py-px text-caption font-bold text-foreground-tertiary">
                {auditEntries.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className={tabTriggerClass}>
              <Bell className="h-[18px] w-[18px]" />
              {t('tabs.notifications')}
            </TabsTrigger>
          </TabsList>
          {tabBarActions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">
              {tabBarActions}
            </div>
          )}
        </div>

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
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onInvite={onInvite}
          />
        )}
        {tab === 'audit' && (
          <AuditToolbar
            dateFilter={dateFilter}
            onDateFilterChange={handleDateFilterChange}
            actionFilter={actionFilter}
            onActionFilterChange={setActionFilter}
            onExportCsv={handleExportCsv}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="overview" className="mt-0">
            {membersLoading || auditLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <OverviewPane
                org={org}
                members={members}
                auditEntries={auditEntries}
                onInvite={onInvite}
                onSwitchTab={setTab}
                extraQuickActions={overviewQuickActions}
                onDelete={onDelete}
              />
            )}
          </TabsContent>

          <TabsContent value="members" className="mt-0">
            {membersLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : membersError ? (
              <p className="text-body3 text-error">{t('members.loadError')}</p>
            ) : (
              <>
                <MembersTable
                  organizationId={org.id}
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
            {internalAuditQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : internalAuditQuery.isError ? (
              <p className="text-body3 text-error">{t('audit.loadError')}</p>
            ) : (
              <>
                <AuditLogTable entries={filteredAuditEntries} />
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-body3 text-foreground-tertiary">
                  <span>{t('audit.eventCount', { count: filteredAuditEntries.length, period: t(`audit.period.${dateFilter}`) })}</span>
                  {hasMoreAudit && auditLimit < 500 && (
                    <button
                      type="button"
                      className="font-semibold text-primary hover:underline"
                      onClick={handleLoadOlder}
                    >
                      {t('audit.loadOlder')} →
                    </button>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="notifications" className="mt-0">
            <DeadlineNotificationDefaults />
          </TabsContent>
        </div>
      </Tabs>
    </PageShell>
  );
}
