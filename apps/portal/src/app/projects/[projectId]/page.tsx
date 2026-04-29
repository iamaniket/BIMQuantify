'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, type JSX } from 'react';

import { PageHeader, Skeleton } from '@bimstitch/ui';

import { ProjectFiles } from '@/features/projects/ProjectFiles';
import { useProject } from '@/features/projects/useProject';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/providers/AuthProvider';

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const { tokens, hasHydrated } = useAuth();
  const projectQuery = useProject(projectId);

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  if (!hasHydrated || tokens === null) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  if (projectQuery.isLoading) {
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    let errorMessage: string;
    if (isNotFound) {
      errorMessage = 'Project not found. It may have been deleted.';
    } else if (error instanceof ApiError) {
      errorMessage = error.detail;
    } else {
      errorMessage = 'Failed to load project.';
    }
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 text-body2 text-foreground-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>
        <div
          role="alert"
          className="mt-6 rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {errorMessage}
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href="/projects"
        className="inline-flex items-center gap-2 self-start text-body2 text-foreground-secondary hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={
          project.description === null || project.description.length === 0
            ? `Created ${formatDate(project.created_at)}`
            : project.description
        }
        actions={undefined}
        className={undefined}
      />

      <h2 className="text-title3 font-semibold text-foreground">Model files</h2>
      <ProjectFiles projectId={project.id} />
    </main>
  );
}
