'use client';

import { Check, ChevronDown, ListFilter } from '@bimstitch/ui/icons';
import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@bimstitch/ui';

import type { Project, ProjectStatusValue } from '@/lib/api/schemas';
import { ProjectStatusEnum } from '@/lib/api/schemas';
import { statusDotClasses } from '@/lib/formatting/projects';

export type StatusFilter = 'all' | ProjectStatusValue | 'archived';

type Props = {
  projects: readonly Project[];
  value: StatusFilter;
  onChange: (next: StatusFilter) => void;
};

const ARCHIVED_DOT_CLASSES = 'bg-foreground-tertiary';

function countsByFilter(projects: readonly Project[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: projects.length,
    planning: 0,
    design: 0,
    permit_review: 0,
    construction: 0,
    handover: 0,
    complete: 0,
    on_hold: 0,
    archived: 0,
  };
  for (const project of projects) {
    if (project.lifecycle_state === 'archived') {
      counts.archived += 1;
      continue;
    }
    if (project.lifecycle_state === 'active') {
      counts[project.status] += 1;
    }
  }
  return counts;
}

type Entry = { key: StatusFilter; label: string; dotClass: string };

export function ProjectStatusFilter({ projects, value, onChange }: Props): JSX.Element {
  const tStatuses = useTranslations('projects.statuses');
  const tFilters = useTranslations('projects.filters');
  const counts = countsByFilter(projects);

  const entries: Entry[] = [
    { key: 'all', label: tFilters('all'), dotClass: 'bg-foreground/50' },
    ...ProjectStatusEnum.options.map((status) => ({
      key: status,
      label: tStatuses(status),
      dotClass: statusDotClasses(status),
    })),
    { key: 'archived', label: tFilters('archived'), dotClass: ARCHIVED_DOT_CLASSES },
  ];

  const active = entries.find((e) => e.key === value) ?? entries[0]!;
  const activeCount = counts[active.key];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="border"
          aria-label={tFilters('ariaLabel')}
          className="inline-flex items-center gap-2"
        >
          <ListFilter className="h-4 w-4 text-foreground-tertiary" />
          <span className={cn('h-1.5 w-1.5 rounded-full', active.dotClass)} />
          <span className="font-medium">{active.label}</span>
          <span className="rounded-full bg-background-secondary px-1.5 text-[10px] font-semibold text-foreground-secondary">
            {activeCount}
          </span>
          <ChevronDown className="h-4 w-4 text-foreground-tertiary" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        {entries.map((entry) => {
          const isActive = entry.key === value;
          return (
            <DropdownMenuItem
              key={entry.key}
              onSelect={() => { onChange(entry.key); }}
              className="justify-between"
            >
              <span className="inline-flex items-center gap-2">
                <span className={cn('h-1.5 w-1.5 rounded-full', entry.dotClass)} />
                <span>{entry.label}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="text-caption text-foreground-tertiary">{counts[entry.key]}</span>
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
