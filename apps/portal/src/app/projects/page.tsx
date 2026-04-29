'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { Input } from '@bimstitch/ui';

import { NewProjectButton } from '@/features/projects/NewProjectButton';
import { ProjectList } from '@/features/projects/ProjectList';
import { useAuth } from '@/providers/AuthProvider';

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
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
