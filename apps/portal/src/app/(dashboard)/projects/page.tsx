'use client';

import { Search } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Input } from '@bimstitch/ui';

import { NewProjectButton } from '@/features/projects/NewProjectButton';
import { ProjectList } from '@/features/projects/ProjectList';

export default function ProjectsPage(): JSX.Element {
  const [search, setSearch] = useState('');

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
          <Input
            type="search"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="w-full pl-9"
            aria-label="Search projects"
          />
        </div>
        <div className="ml-auto">
          <NewProjectButton />
        </div>
      </div>

      <ProjectList search={search} />
    </main>
  );
}
