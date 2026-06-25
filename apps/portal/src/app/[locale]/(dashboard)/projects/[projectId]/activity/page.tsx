'use client';

import { LayoutGrid, Search, Table2 } from '@bimdossier/ui/icons';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge, Input, Skeleton, TabsContent } from '@bimdossier/ui';

import { DataTable } from '@/components/shared/DataTable';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { ActivityPageHero } from '@/features/activity/ActivityPageHero';
import {
  ActivityFilterSelects,
  PAGE_SIZE_OPTIONS,
  useActivityColumns,
  useActivityTable,
} from '@/features/activity/activityTable';
import { ActivityOverviewTab } from '@/features/activity/tabs/ActivityOverviewTab';
import { useProjectActivityTimeline } from '@/features/projects/detail/ActivityTimelinePanel';
import { useProject } from '@/features/projects/useProject';
import { ApiError } from '@/lib/api/client';

/**
 * Dedicated per-project Activity page — the "hero + tabbed" pattern shared with
 * Reports / Certificates / Attachments. Overview tab (KPIs + charts) plus the
 * full, server-paginated event feed. Lands on the feed tab; the two feed filters
 * (time window + category) live in the shell toolbar.
 */
export default function ProjectActivityPage(): JSX.Element {
  const t = useTranslations('activity.hub');
  const tActivity = useTranslations('activity');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const [tab, setTab] = useState('activity');

  const projectQuery = useProject(projectId);
  const timelineQuery = useProjectActivityTimeline(projectId);
  const {
    table, timeWindow, setTimeWindow, typeFilter, setTypeFilter, search, setSearch,
  } = useActivityTable(projectId);
  const columns = useActivityColumns();

  const projectName = projectQuery.data?.name;
  const crumbs = useMemo(
    () => (projectName === undefined
      ? null
      : [
        { label: t('crumbProjects'), href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t],
  );
  useHeaderCrumbsOverride(crumbs);

  if (projectQuery.isLoading) {
    return (
      <PageShell
        hero={(
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[112px] w-[160px] rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        )}
      >
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-6">
        <ErrorBanner
          message={isNotFound ? t('projectNotFound') : t('projectLoadError')}
          tone="soft"
          className="text-body2"
        />
      </main>
    );
  }

  const project = projectQuery.data;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    activity: { eyebrow: t('panel.activityEyebrow'), title: t('panel.activityTitle', { count: table.total }) },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<ActivityPageHero projectName={project.name} timeline={timelineQuery.data} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'activity',
          label: t('tabs.activity'),
          icon: <Table2 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{table.total}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'activity'}
      toolbar={tab === 'activity' ? (
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          <Input
            inputSize="md"
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={tActivity('searchPlaceholder')}
            leading={<Search className="h-3.5 w-3.5" />}
            className="w-full max-w-xs"
          />
          <div className="flex-1" />
          <ActivityFilterSelects
            timeWindow={timeWindow}
            onTimeWindow={setTimeWindow}
            typeFilter={typeFilter}
            onTypeFilter={setTypeFilter}
          />
        </div>
      ) : undefined}
    >
      <TabsContent value="overview" className="mt-0">
        {timelineQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ActivityOverviewTab timeline={timelineQuery.data} />
        )}
      </TabsContent>

      <TabsContent value="activity" className="mt-0 flex min-h-0 flex-1 flex-col">
        <DataTable
          columns={columns}
          data={table.rows}
          rowKey={(e) => e.id}
          emptyMessage={t('list.empty')}
          sort={table.sort}
          onToggleSort={table.toggleSort}
          isLoading={table.isLoading}
          isFetching={table.isFetching}
          isError={table.isError}
          errorMessage={t('list.loadError')}
          rowClassName="hover:bg-background-hover"
          clipHorizontal
        />
        <TablePaginationFooter
          table={table}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
