'use client';

import { FolderOpen, Search } from 'lucide-react';
import { useState, type JSX } from 'react';

import {
  Card, CardBody, CardFooter, EmptyState, Input, Skeleton,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';

import { ProjectCard } from './ProjectCard';
import { useProjects } from './useProjects';

const SKELETON_COUNT = 6;

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4';

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
  const [search, setSearch] = useState('');

  const searchBar = (
    <div className="relative mb-6">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
      <Input
        type="search"
        placeholder="Search projects…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); }}
        className="pl-9"
        aria-label="Search projects"
      />
    </div>
  );

  if (query.isLoading) {
    return (
      <>
        {searchBar}
        <div className={GRID_CLASS}>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <ProjectSkeleton key={`skeleton-${String(i)}`} />
          ))}
        </div>
      </>
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
  const filtered = term.length === 0
    ? projects
    : projects.filter(
        (p) => p.name.toLowerCase().includes(term)
          || (p.description?.toLowerCase().includes(term) ?? false),
      );

  return (
    <>
      {searchBar}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          description={`No projects match "${search}". Try a different search.`}
          action={undefined}
          className={undefined}
        />
      ) : (
        <div className={GRID_CLASS}>
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </>
  );
}

