'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { FindingsBoardHero } from '@/features/findings/board/FindingsBoardHero';
import { FindingsKanbanBoard } from '@/features/findings/board/FindingsKanbanBoard';
import { useFindings } from '@/features/findings/useFindings';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useProject } from '@/features/projects/useProject';
import { ApiError } from '@/lib/api/client';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

export default function FindingsBoardPage(): JSX.Element {
  const t = useTranslations('findingsBoard');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

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

  if (projectQuery.isLoading || findingsQuery.isLoading) {
    return (
      <PageShell
        hero={
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[140px] w-[200px] rounded-[10px]" />
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

  return (
    <PageShell
      hero={
        <FindingsBoardHero
          projectName={project.name}
          findings={findings}
        />
      }
    >
      <FindingsKanbanBoard
        projectId={projectId}
        findings={findings}
        members={members}
      />
    </PageShell>
  );
}
