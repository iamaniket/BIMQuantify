'use client';

import { Building2, Pencil } from '@bimstitch/ui/icons';
import { useLocale } from 'next-intl';
import { useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import type { Project } from '@/lib/api/schemas';

import { ProjectFormDialog } from './ProjectFormDialog';
import { isProjectArchived } from '@/lib/formatting/projects';
import { formatDate } from '@/lib/formatting/dates';

type Props = {
  project: Project;
};

export function ProjectHeader({ project }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const [editOpen, setEditOpen] = useState(false);
  const archived = isProjectArchived(project);

  return (
    <header className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5 sm:flex-row sm:items-start">
      <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-md border border-border bg-background-secondary">
        {project.thumbnail_url === null ? (
          <Building2 className="h-10 w-10 text-foreground-tertiary" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.thumbnail_url}
            alt={`${project.name} cover`}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1 className="truncate text-title2 font-semibold text-foreground">
          {project.name}
        </h1>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-body3 text-foreground-secondary sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-foreground-tertiary">Created</dt>
            <dd>{formatDate(project.created_at, locale)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-foreground-tertiary">Updated</dt>
            <dd>{formatDate(project.updated_at, locale)}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-none items-center gap-2">
        <Button
          type="button"
          variant="border"
          size="md"
          disabled={archived}
          onClick={() => { setEditOpen(true); }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          {archived ? 'Archived' : 'Edit'}
        </Button>
      </div>

      <ProjectFormDialog
        mode="edit"
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </header>
  );
}
