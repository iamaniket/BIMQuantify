'use client';

import { useParams } from 'next/navigation';

import { useEffect, useState, type JSX } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { Button, Skeleton } from '@bimdossier/ui';
import {
  Activity, ArrowRight, Pencil, Settings, Share2,
} from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { ApiError } from '@/lib/api/client';
import { useDocuments } from '@/features/documents/useDocuments';
import { useProjectOverview } from '@/features/projects/useProjectOverview';
import { projectDeadlinesKey, projectKey, projectMembersKey } from '@/features/projects/queryKeys';
import { PageShell } from '@/components/shared/layout/PageShell';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ProjectDetailHeader } from '@/features/projects/detail/ProjectDetailHeader';
import { ProjectChartsPanel } from '@/features/projects/detail/ProjectChartsPanel';
import { ActivityTimelinePanel } from '@/features/projects/detail/ActivityTimelinePanel';
import { RightColumnTabs } from '@/features/projects/detail/RightColumnTabs';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { ProjectSettingsDialog } from '@/features/projects/detail/ProjectSettingsDialog';
import { RemoveProjectButton } from '@/features/projects/detail/RemoveProjectButton';
import { isProjectArchived } from '@/lib/formatting/projects';
import { Link } from '@/i18n/navigation';

export default function ProjectDetailPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const tHero = useTranslations('projectDetail.hero');
  const tActivity = useTranslations('activity');
  const queryClient = useQueryClient();
  // One aggregate request feeds the whole dashboard — header KPIs, the
  // completeness donut, the four launcher cards and the deadlines/readiness
  // panels all read from this single query (see `useProjectOverview`). The only
  // remaining cold-load request is the documents list (head versions), which
  // the aggregate intentionally does not carry.
  const overviewQuery = useProjectOverview(projectId);
  const documentsQuery = useDocuments(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    track(PORTAL_EVENTS.PROJECT_OPENED, { project_id: projectId });
  }, [projectId]);

  // Seed the per-resource caches the lazy tabs / assignee avatars / sub-pages
  // read from, straight out of the aggregate. The lists are full (uncapped) in
  // the overview payload, so opening the Deadlines tab, rendering finding
  // assignee avatars, or navigating to a sub-page (findings/reports/attachments/
  // access/activity/certificates — which call useProject/useProjectMembers for
  // breadcrumbs + avatars) resolves from cache instead of firing another request.
  const overview = overviewQuery.data;
  useEffect(() => {
    if (overview === undefined) return;
    queryClient.setQueryData(projectKey(projectId), overview.project);
    queryClient.setQueryData(projectDeadlinesKey(projectId), overview.deadlines.preview);
    queryClient.setQueryData(projectMembersKey(projectId), overview.members);
  }, [overview, projectId, queryClient]);

  if (overviewQuery.isLoading) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid flex-1 grid-cols-2 gap-3.5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (overviewQuery.isError) {
    const { error } = overviewQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    const errorMessage = isNotFound
      ? tHero('notFound')
      : error instanceof ApiError
        ? error.detail
        : tHero('loadFailed');
    return (
      <main className="p-6">
        <ErrorBanner message={errorMessage} tone="soft" className="text-body2" />
      </main>
    );
  }

  if (overview === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  const project = overview.project;
  const documents = documentsQuery.data ?? [];

  const deadlinesSummary = {
    met: overview.deadlines.met,
    total: overview.deadlines.total,
    overdue: overview.deadlines.overdue,
  };

  const heroAction = (
    <>
      <Button
        variant="border"
        disabled={isProjectArchived(project)}
        onClick={() => { setEditOpen(true); }}
      >
        <Pencil className="mr-1 h-3.5 w-3.5" />
        {tHero('editProject')}
      </Button>
      <Button
        variant="border"
        disabled={isProjectArchived(project)}
        onClick={() => { setSettingsOpen(true); }}
      >
        <Settings className="mr-1 h-3.5 w-3.5" />
        {tHero('settings')}
      </Button>
      <Button variant="border" size="md" asChild>
        <Link href={`/projects/${project.id}/access`}>
          <Share2 className="mr-1 h-3.5 w-3.5" /> {tHero('projectAccess')}
        </Link>
      </Button>
      <RemoveProjectButton project={project} />
    </>
  );

  return (
    <>
      <PageShell
        hero={
          <ProjectDetailHeader
            project={project}
            deadlinesSummary={deadlinesSummary}
            attachmentCount={overview.stats.attachments_count}
            dossierPct={overview.completeness.dossier.pct}
            action={heroAction}
          />
        }
      >
        {documentsQuery.isError && (
          <div className="px-3.5 pt-3.5">
            <ErrorBanner message={tHero('partialDataError')} tone="soft" className="text-body2" />
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-rows-[1fr_2fr] grid-cols-1 gap-3.5 overflow-hidden px-3.5 pb-3.5 lg:grid-rows-1 lg:grid-cols-[45fr_65fr]">
          <div className="flex min-h-0 flex-col gap-3.5">
            <ProjectChartsPanel
              completeness={overview.completeness}
              country={project.country}
            />
            <ActivityTimelinePanel
              projectId={projectId}
              headerAction={(
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/projects/${projectId}/activity`}>
                    <Activity className="mr-1 h-3.5 w-3.5" />
                    {tActivity('viewAll')}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              )}
            />
          </div>

          <RightColumnTabs
            projectId={projectId}
            projectCountry={project.country}
            documents={documents}
            deadlinesTotal={overview.deadlines.total}
            dossier={overview.completeness.dossier}
          />
        </div>
      </PageShell>
      <ProjectFormDialog
        mode="edit"
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectId={projectId}
      />
    </>
  );
}
