'use client';

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

  return (
    <Card>
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
        <ProjectCardMenu project={project} />
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
        <span className="text-caption text-foreground-tertiary">
          {createdLabel === '' ? '' : `Created ${createdLabel}`}
        </span>
      </CardFooter>
    </Card>
  );
}
