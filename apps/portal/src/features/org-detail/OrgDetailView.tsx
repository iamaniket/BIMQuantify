'use client';

import { Activity, Bell, LayoutGrid, Shield, Users } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import {
  cn,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimdossier/ui';

import { PageShell } from '@/components/shared/layout/PageShell';
import { PanelHeading } from '@/components/shared/PanelHeading';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { MembersTable } from '@/features/admin/members/MembersTable';
import { DeadlineNotificationDefaults } from '@/features/admin/notifications/DeadlineNotificationDefaults';

import { OrgDetailHero } from './OrgDetailHero';
import { AuditToolbar, MembersToolbar } from './OrgDetailToolbars';
import { OverviewPane } from './OverviewPane';
import type { OrgDetailViewProps } from './types';
import { useOrgDetailData } from './useOrgDetailData';

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

  const {
    tab,
    setTab,
    query,
    setQuery,
    roleFilter,
    setRoleFilter,
    statusFilter,
    setStatusFilter,
    dateFilter,
    actionFilter,
    setActionFilter,
    filteredAuditEntries,
    handleDateFilterChange,
    handleExportCsv,
    membersTable,
    auditTable,
    activeCount,
    pendingCount,
  } = useOrgDetailData({ org, members, membersLoading, membersError });

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


  const storageOverLimit = org.activeStorageLimitGb !== null && org.activeStorageUsedGb >= org.activeStorageLimitGb;

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
      {storageOverLimit && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-body3 text-warning-dark dark:text-warning">
          <Shield className="h-4 w-4 shrink-0" />
          <span>
            {t('hero.storageWarning', {
              used: org.activeStorageUsedGb,
              limit: org.activeStorageLimitGb!,
            })}
          </span>
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center border-b border-border bg-surface-main px-5">
          <TabsList className="min-w-0 flex-1 gap-1 rounded-none border-b-0 bg-transparent p-0">
            <TabsTrigger value="overview" className={TAB_TRIGGER_CLASS}>
              <LayoutGrid className="h-4 w-4" />
              {t('tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="members" className={TAB_TRIGGER_CLASS}>
              <Users className="h-4 w-4" />
              {t('tabs.members')}
              <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
                {members.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="audit" className={TAB_TRIGGER_CLASS}>
              <Activity className="h-4 w-4" />
              {t('tabs.audit')}
              <span className="rounded-full bg-background-hover px-1.5 py-px text-caption font-bold text-foreground-tertiary">
                {auditEntries.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="notifications" className={TAB_TRIGGER_CLASS}>
              <Bell className="h-4 w-4" />
              {t('tabs.notifications')}
            </TabsTrigger>
          </TabsList>
          {tabBarActions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">
              {tabBarActions}
            </div>
          )}
        </div>

        <PanelHeading eyebrow={panelHeading.eyebrow} title={panelHeading.title} sub={panelHeading.sub} />

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

        <div
          className={cn(
            'min-h-0 flex-1',
            tab === 'members' || tab === 'audit'
              ? 'flex flex-col overflow-hidden'
              : 'overflow-y-auto p-5',
          )}
        >
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

          <TabsContent value="members" className="mt-0 flex min-h-0 flex-1 flex-col">
            <MembersTable
              organizationId={org.id}
              table={membersTable}
              allMembers={members}
              loadError={t('members.loadError')}
            />
            <TablePaginationFooter
              table={membersTable}
              className="shrink-0 border-t border-border px-5 py-2.5"
            />
          </TabsContent>

          <TabsContent value="audit" className="mt-0 flex min-h-0 flex-1 flex-col">
            <AuditLogTable table={auditTable} />
            <TablePaginationFooter
              table={auditTable}
              className="shrink-0 border-t border-border px-5 py-2.5"
            />
          </TabsContent>

          <TabsContent value="notifications" className="mt-0">
            <DeadlineNotificationDefaults />
          </TabsContent>
        </div>
      </Tabs>
    </PageShell>
  );
}
