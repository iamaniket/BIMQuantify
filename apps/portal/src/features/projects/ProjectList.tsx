'use client';

import { FolderOpen, Search } from '@bimstitch/ui/icons';
import { type JSX } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import {
  Card, CardBody, CardFooter, EmptyState, Skeleton,
} from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';

import { ApiError } from '@/lib/api/client';
import { listProjectMembers } from '@/lib/api/projectMembers';
import type { ProjectMemberList } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { ProjectCard } from './ProjectCard';
import type { PhaseFilter } from './ProjectPhaseFilter';
import { projectMembersKey } from './queryKeys';
import { useProjects } from './useProjects';

const SKELETON_COUNT = 6;

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4';

function ProjectSkeleton(): JSX.Element {
  return (
    <Card>
      <Skeleton className="h-32 w-full rounded-none" />
      <CardBody>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </CardBody>
      <CardFooter>
        <Skeleton className="h-3 w-24" />
      </CardFooter>
    </Card>
  );
}

type ProjectListProps = {
  search: string;
  phaseFilter: PhaseFilter;
};

export function ProjectList({ search, phaseFilter }: ProjectListProps): JSX.Element {
  const t = useTranslations('projects.list');
  const { tokens } = useAuth();
  const query = useProjects();
  const accessToken = tokens === null ? null : tokens.access_token;

  const projects = query.data ?? [];
  const term = search.trim().toLowerCase();
  const searchFiltered = term.length === 0
    ? projects
    : projects.filter((p) => {
      const haystacks: (string | null)[] = [
        p.name, p.description, p.reference_code,
        p.city,
      ];
      return haystacks.some((s) => {
        if (s === null) {
          return false;
        }
        return s.toLowerCase().includes(term);
      });
    });

  let filtered = searchFiltered;
  if (phaseFilter === 'archived') {
    filtered = searchFiltered.filter((p) => p.lifecycle_state === 'archived');
  } else if (phaseFilter !== 'all') {
    filtered = searchFiltered.filter(
      (p) => p.lifecycle_state === 'active' && p.phase === phaseFilter,
    );
  }

  const memberQueryProjects = query.isSuccess ? filtered : [];
  const projectMembersQueries = useQueries({
    queries: memberQueryProjects.map((project) => ({
      queryKey: projectMembersKey(project.id),
      queryFn: () => {
        if (accessToken === null) {
          throw new Error('Not authenticated');
        }
        return listProjectMembers(accessToken, project.id);
      },
      enabled: accessToken !== null,
      staleTime: 60_000,
    })),
  });

  const membersByProjectId = new Map<string, ProjectMemberList>();
  memberQueryProjects.forEach((project, index) => {
    const members = projectMembersQueries[index]?.data;
    if (members !== undefined) {
      membersByProjectId.set(project.id, members);
    }
  });

  if (query.isLoading) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <ProjectSkeleton key={`skeleton-${String(i)}`} />
        ))}
      </div>
    );
  }

  if (query.isError) {
    const message = query.error instanceof ApiError
      ? query.error.detail
      : t('errors.loadFailed');
    return <ErrorBanner message={message} tone="soft" className="text-body2" />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={t('emptyAll.title')}
        description={t('emptyAll.description')}
        action={undefined}
        className={undefined}
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={t('emptyFiltered.title')}
        description={
          term.length === 0
            ? t('emptyFiltered.descriptionNoSearch')
            : t('emptyFiltered.descriptionWithSearch', { search })
        }
        action={undefined}
        className={undefined}
      />
    );
  }

  return (
    <div className={GRID_CLASS}>
      {filtered.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          members={membersByProjectId.get(project.id) ?? []}
        />
      ))}
    </div>
  );
}
