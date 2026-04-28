'use client';

import { FolderOpen } from 'lucide-react';
import type { JSX } from 'react';

import {
  Card, CardBody, CardFooter, EmptyState, Skeleton,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';

import { ProjectCard } from './ProjectCard';
import { useProjects } from './useProjects';

const SKELETON_COUNT = 6;

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

export function ProjectList(): JSX.Element {
  const query = useProjects();

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
