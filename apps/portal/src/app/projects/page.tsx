'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { PageHeader } from '@bimstitch/ui';

import { NewProjectButton } from '@/features/projects/NewProjectButton';
import { ProjectList } from '@/features/projects/ProjectList';
import { useAuth } from '@/providers/AuthProvider';

export default function ProjectsPage(): JSX.Element {
  const router = useRouter();
  const { tokens, hasHydrated } = useAuth();

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
      <PageHeader
        title="Projects"
        subtitle="Your organization's projects"
        actions={<NewProjectButton />}
        className={undefined}
      />
      <ProjectList />
    </main>
  );
}
