'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import {
  Card, CardBody, CardFooter, cn,
} from '@bimstitch/ui';

import type { Project } from '@/lib/api/schemas';

import { ProjectCardMenu } from './ProjectCardMenu';

const tileColors: readonly string[] = [
  'bg-primary',
  'bg-success',
  'bg-warning',
  'bg-info',
  'bg-error',
  'bg-primary-hover',
];

const FALLBACK_TILE_COLOR = 'bg-primary';

function pickTileColor(seed: string): string {
  if (seed.length === 0) {
    return FALLBACK_TILE_COLOR;
  }
  const idx = seed.charCodeAt(0) % tileColors.length;
  return tileColors[idx] ?? FALLBACK_TILE_COLOR;
}

function formatCreatedDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

type Props = {
  project: Project;
};

export function ProjectCard({ project }: Props): JSX.Element {
  const initial = project.name.length === 0
    ? '?'
    : project.name.charAt(0).toUpperCase();
  const tileColor = pickTileColor(project.name);
  const createdLabel = formatCreatedDate(project.created_at);
  const updatedLabel = formatCreatedDate(project.updated_at);
  // Only surface the updated label when the date is genuinely different from creation
  const showUpdated = updatedLabel !== '' && updatedLabel !== createdLabel;

  return (
    <Card>
      <Link
        href={`/projects/${project.id}`}
        className="flex flex-col gap-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative">
          {project.thumbnail_url === null ? (
            <div
              className={cn(
                'flex h-32 items-center justify-center text-h4 font-semibold text-primary-foreground',
                tileColor,
              )}
            >
              {initial}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url}
              alt=""
              className="h-32 w-full object-cover"
            />
          )}
        </div>

        <CardBody>
          <h3 className="text-title3 font-semibold text-foreground">
            {project.name}
          </h3>
          {project.description === null || project.description.length === 0 ? (
            <p className="text-body2 italic text-foreground-tertiary">
              No description
            </p>
          ) : (
            <p className="line-clamp-2 text-body2 text-foreground-secondary">
              {project.description}
            </p>
          )}
        </CardBody>

        <CardFooter>
          <span className="flex flex-col gap-0.5 text-caption text-foreground-tertiary">
            {createdLabel === '' ? null : (
              <span>Created {createdLabel}</span>
            )}
            {showUpdated ? (
              <span>Updated {updatedLabel}</span>
            ) : null}
          </span>
        </CardFooter>
      </Link>
      <ProjectCardMenu project={project} />
    </Card>
  );
}
