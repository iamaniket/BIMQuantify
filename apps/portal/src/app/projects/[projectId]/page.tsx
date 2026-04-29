'use client';

import { Layers, Pencil, Plus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { Button, EmptyState, Skeleton } from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import { ModelCard } from '@/features/projects/ModelCard';
import { NewModelDialog } from '@/features/projects/NewModelDialog';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { useModels } from '@/features/projects/useModels';
import { useProject } from '@/features/projects/useProject';
import { useAuth } from '@/providers/AuthProvider';

export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const { tokens, setTokens, hasHydrated } = useAuth();
  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const isUnauthorized = projectQuery.isError && projectQuery.error instanceof ApiError
    && (projectQuery.error.status === 401 || projectQuery.error.status === 403);

  useEffect(() => {
    if (hasHydrated && tokens === null) {
      router.replace('/login');
    }
  }, [router, tokens, hasHydrated]);

  useEffect(() => {
    if (isUnauthorized) {
      setTokens(null);
      router.replace('/login');
    }
  }, [isUnauthorized, setTokens, router]);

  if (!hasHydrated || tokens === null || isUnauthorized) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  if (projectQuery.isLoading) {
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
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
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
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

  const models = modelsQuery.data ?? [];
  const modelsError = modelsQuery.error;
  const description = project.description === null || project.description.trim().length === 0
    ? null
    : project.description;

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-h6 font-semibold text-foreground">{project.name}</h1>
          {description !== null ? (
            <p className="text-body2 text-foreground-secondary">{description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="border"
          size="sm"
          onClick={() => { setEditOpen(true); }}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-title3 font-semibold text-foreground">Models</h2>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => { setNewModelOpen(true); }}
        >
          <Plus className="mr-1 h-4 w-4" />
          New model
        </Button>
      </div>

      {modelsError === null ? null : (
        <div
          role="alert"
          className="mb-4 rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {modelsError instanceof ApiError ? modelsError.detail : 'Failed to load models.'}
        </div>
      )}

      {modelsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : null}

      {!modelsQuery.isLoading && models.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No models yet"
          description="Create a model to group IFC versions by discipline."
          action={
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => { setNewModelOpen(true); }}
            >
              <Plus className="mr-1 h-4 w-4" />
              New model
            </Button>
          }
          className={undefined}
        />
      ) : null}

      {models.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {models.map((model) => (
            <ModelCard key={model.id} projectId={project.id} model={model} />
          ))}
        </div>
      )}

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={project.id}
      />
      <ProjectFormDialog
        mode="edit"
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </main>
  );
}
