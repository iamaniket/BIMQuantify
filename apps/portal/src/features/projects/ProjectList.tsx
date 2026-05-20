'use client';

import { FolderOpen, Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';

import {
  Card, CardBody, CardFooter, EmptyState, Skeleton,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/providers/AuthProvider';

import { ProjectCard } from './ProjectCard';
import type { StatusFilter } from './ProjectStatusFilter';
import { useProjects } from './useProjects';

const SKELETON_COUNT = 6;

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4';

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
  statusFilter: StatusFilter;
};

export function ProjectList({ search, statusFilter }: ProjectListProps): JSX.Element {
  const router = useRouter();
  const { setTokens } = useAuth();
  const query = useProjects();

  const isUnauthorized = query.isError && query.error instanceof ApiError
    && (query.error.status === 401 || query.error.status === 403);

  useEffect(() => {
    if (isUnauthorized) {
      setTokens(null);
      router.replace('/login');
    }
  }, [isUnauthorized, setTokens, router]);

  if (isUnauthorized) {
    return <div />;
  }

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
      : 'Failed to load projects.';
    return (
      <div
        role="alert"
        className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
      >
        {message}
      </div>
    );
  }

  const projects = query.data;
  if (projects === undefined || projects.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No projects yet"
        description="Projects you create or are added to will show up here."
        action={undefined}
        className={undefined}
      />
    );
  }

  const term = search.trim().toLowerCase();
  const searchFiltered = term.length === 0
    ? projects
    : projects.filter((p) => {
      const haystacks: (string | null)[] = [
        p.name, p.description, p.reference_code,
        p.city, p.contractor_name,
      ];
      return haystacks.some((s) => {
        if (s === null) {
          return false;
        }
        return s.toLowerCase().includes(term);
      });
    });

  let filtered = searchFiltered;
  if (statusFilter === 'archived') {
    filtered = searchFiltered.filter((p) => p.lifecycle_state === 'archived');
  } else if (statusFilter !== 'all') {
    filtered = searchFiltered.filter(
      (p) => p.lifecycle_state === 'active' && p.status === statusFilter,
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matching projects"
        description={
          term.length === 0
            ? 'No projects match the selected filter.'
            : `No projects match "${search}". Try a different search.`
        }
        action={undefined}
        className={undefined}
      />
    );
  }

  return (
    <div className={GRID_CLASS}>
      {filtered.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
