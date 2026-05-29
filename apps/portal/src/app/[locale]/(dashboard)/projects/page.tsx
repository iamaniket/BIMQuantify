'use client';

import { Search } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from '@bimstitch/ui';

import { NewProjectButton } from '@/features/projects/NewProjectButton';
import { ProjectList } from '@/features/projects/ProjectList';
import { ProjectStatusFilter, type StatusFilter } from '@/features/projects/ProjectStatusFilter';
import { useProjects } from '@/features/projects/useProjects';

export default function ProjectsPage(): JSX.Element {
  const t = useTranslations('projects.page');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="w-full pl-9"
            aria-label={t('searchAriaLabel')}
          />
        </div>
        <ProjectStatusFilter
          projects={projects}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <div className="ml-auto">
          <NewProjectButton />
        </div>
      </div>

      <ProjectList search={search} statusFilter={statusFilter} />
    </main>
  );
}
