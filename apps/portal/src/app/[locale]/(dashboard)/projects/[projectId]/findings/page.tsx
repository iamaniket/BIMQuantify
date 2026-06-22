'use client';

import {
  CalendarDays,
  Columns3,
  Image as ImageIcon,
  LayoutGrid,
  MapPin,
  Settings,
} from '@bimstitch/ui/icons';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useEffect, useMemo, useState, type JSX,
} from 'react';

import { Badge, Skeleton, TabsContent } from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { FindingsBoardHero } from '@/features/findings/board/FindingsBoardHero';
import { FindingsKanbanBoard } from '@/features/findings/board/FindingsKanbanBoard';
import { ProjectCalendarTab } from '@/features/findings/calendar/ProjectCalendarTab';
import { FindingsLocationsTab } from '@/features/findings/tabs/FindingsLocationsTab';
import { FindingsOverviewTab } from '@/features/findings/tabs/FindingsOverviewTab';
import { FindingsPhotosTab } from '@/features/findings/tabs/FindingsPhotosTab';
import { FindingsSettingsTab } from '@/features/findings/tabs/FindingsSettingsTab';
import { useFindings } from '@/features/findings/useFindings';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useProject } from '@/features/projects/useProject';
import { ApiError } from '@/lib/api/client';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

export default function FindingsBoardPage(): JSX.Element {
  const t = useTranslations('findingsBoard');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const [tab, setTab] = useState('board');

  const projectQuery = useProject(projectId);
  const findingsQuery = useFindings(projectId);
  const membersQuery = useProjectMembers(projectId);

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

  // Eagerly load every findings page so the Overview charts (and the calendar /
  // locations / board tabs) aggregate over the full set, not just the first 50.
  const {
    hasNextPage: hasMoreFindings,
    isFetchingNextPage: isFetchingMoreFindings,
    fetchNextPage: fetchMoreFindings,
  } = findingsQuery;
  useEffect(() => {
    if (hasMoreFindings && !isFetchingMoreFindings) {
      void fetchMoreFindings();
    }
  }, [hasMoreFindings, isFetchingMoreFindings, fetchMoreFindings]);

  if (projectQuery.isLoading || findingsQuery.isLoading) {
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
        <div className="flex gap-4 p-3.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-[280px] shrink-0 rounded-lg" />
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
          message={isNotFound ? 'Project not found.' : 'Failed to load project.'}
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

  const findings = flattenPages(findingsQuery.data);
  const members = membersQuery.data ?? [];

  const panelHeading = {
    board: { eyebrow: t('panel.boardEyebrow'), title: t('panel.boardTitle') },
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    calendar: { eyebrow: t('panel.calendarEyebrow'), title: t('panel.calendarTitle') },
    locations: { eyebrow: t('panel.locationsEyebrow'), title: t('panel.locationsTitle') },
    photos: { eyebrow: t('panel.photosEyebrow'), title: t('panel.photosTitle') },
    settings: { eyebrow: t('panel.settingsEyebrow'), title: t('panel.settingsTitle') },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<FindingsBoardHero projectName={project.name} findings={findings} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'board',
          label: t('tabs.board'),
          icon: <Columns3 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{findings.length}</Badge>,
        },
        { value: 'calendar', label: t('tabs.calendar'), icon: <CalendarDays className="h-4 w-4" /> },
        { value: 'locations', label: t('tabs.locations'), icon: <MapPin className="h-4 w-4" /> },
        { value: 'photos', label: t('tabs.photos'), icon: <ImageIcon className="h-4 w-4" /> },
        { value: 'settings', label: t('tabs.settings'), icon: <Settings className="h-4 w-4" /> },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
    >
      <TabsContent value="board" className="mt-0 h-full">
        <div className="flex h-full min-h-0 flex-col">
          <FindingsKanbanBoard projectId={projectId} findings={findings} members={members} />
        </div>
      </TabsContent>

      <TabsContent value="overview" className="mt-0">
        <FindingsOverviewTab projectId={projectId} findings={findings} members={members} />
      </TabsContent>

      <TabsContent value="calendar" className="mt-0 h-full">
        <ProjectCalendarTab projectId={projectId} findings={findings} />
      </TabsContent>

      <TabsContent value="locations" className="mt-0">
        <FindingsLocationsTab projectId={projectId} findings={findings} />
      </TabsContent>

      <TabsContent value="photos" className="mt-0">
        <FindingsPhotosTab projectId={projectId} findings={findings} />
      </TabsContent>

      <TabsContent value="settings" className="mt-0">
        <FindingsSettingsTab projectId={projectId} />
      </TabsContent>
    </TabbedPageShell>
  );
}
