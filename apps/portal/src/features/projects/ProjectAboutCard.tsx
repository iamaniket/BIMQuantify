'use client';

import type { JSX } from 'react';

import type { Project } from '@/lib/api/schemas';

type Props = {
  project: Project;
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

export function ProjectAboutCard({ project }: Props): JSX.Element {
  const description = project.description === null || project.description.trim().length === 0
    ? null
    : project.description;

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <section className="flex flex-col gap-1.5">
        <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
          Description
        </h2>
        {description === null ? (
          <p className="text-body3 italic text-foreground-tertiary">
            No description.
          </p>
        ) : (
          <p className="whitespace-pre-line text-body2 text-foreground-secondary">
            {description}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="text-caption font-medium uppercase tracking-wide text-foreground-tertiary">
          Details
        </h2>
        <dl className="flex flex-col gap-1 text-body3">
          <div className="flex justify-between gap-2">
            <dt className="text-foreground-tertiary">Created</dt>
            <dd className="text-foreground-secondary">{formatDate(project.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-foreground-tertiary">Updated</dt>
            <dd className="text-foreground-secondary">{formatDate(project.updated_at)}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
