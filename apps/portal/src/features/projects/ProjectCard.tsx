'use client';

import { Building2, Layers, Ruler } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

import {
  Card, CardBody, CardFooter,
} from '@bimstitch/ui';

import type { Project } from '@/lib/api/schemas';

import { ProjectCardMenu } from './ProjectCardMenu';

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
  const createdLabel = formatCreatedDate(project.created_at);

  return (
    <Card>
      <Link
        href={`/projects/${project.id}`}
        className="flex flex-col gap-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative">
          {project.thumbnail_url === null ? (
            <div className="flex h-36 items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-100">
              <Building2 className="h-10 w-10 text-slate-300" />
              <Layers className="h-7 w-7 text-slate-200" />
              <Ruler className="h-6 w-6 text-slate-200" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url}
              alt=""
              className="h-36 w-full object-cover"
            />
          )}
        </div>

        <CardBody>
          <h3 className="text-title3 font-semibold text-foreground">
            {project.name}
          </h3>
          {project.description === null || project.description.length === 0 ? null : (
            <p className="line-clamp-2 text-body2 text-foreground-secondary">
              {project.description}
            </p>
          )}
        </CardBody>

        <CardFooter>
          {createdLabel === '' ? null : (
            <span className="text-caption text-foreground-tertiary">
              Created {createdLabel}
            </span>
          )}
        </CardFooter>
      </Link>
      <ProjectCardMenu project={project} />
    </Card>
  );
}
