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

import type { Project, ProjectPhaseValue } from '@/lib/api/schemas';
import { ProjectPhaseEnum } from '@/lib/api/schemas';
import { phaseDotClasses } from '@/lib/formatting/projects';

export type PhaseFilter = 'all' | ProjectPhaseValue | 'archived';

type Props = {
  projects: readonly Project[];
  value: PhaseFilter;
  onChange: (next: PhaseFilter) => void;
};

const ARCHIVED_DOT_CLASSES = 'bg-foreground-tertiary';

function countsByFilter(projects: readonly Project[]): Record<PhaseFilter, number> {
  const counts: Record<PhaseFilter, number> = {
    all: projects.length,
    design: 0,
    tender: 0,
    work_prep: 0,
    shell: 0,
    finishing: 0,
    handover: 0,
    archived: 0,
  };
  for (const project of projects) {
    if (project.lifecycle_state === 'archived') {
      counts.archived += 1;
      continue;
    }
    if (project.lifecycle_state === 'active') {
      counts[project.phase] += 1;
    }
  }
  return counts;
}

type Entry = { key: PhaseFilter; label: string; dotClass: string };

export function ProjectPhaseFilter({ projects, value, onChange }: Props): JSX.Element {
  const tPhases = useTranslations('projects.phases');
  const tFilters = useTranslations('projects.filters');
  const counts = countsByFilter(projects);

  const entries: Entry[] = [
    { key: 'all', label: tFilters('all'), dotClass: 'bg-foreground/50' },
    ...ProjectPhaseEnum.options.map((phase) => ({
      key: phase,
      label: tPhases(phase),
      dotClass: phaseDotClasses(phase),
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
