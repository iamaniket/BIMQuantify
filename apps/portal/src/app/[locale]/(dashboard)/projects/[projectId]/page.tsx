'use client';

import { useParams } from 'next/navigation';

import { useState, type JSX } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, Skeleton } from '@bimstitch/ui';

import { ModelFiles } from '@/features/models/ModelFiles';

import { ApiError } from '@/lib/api/client';
import { useModels } from '@/features/models/useModels';
import { useProject } from '@/features/projects/useProject';
import { PageShell } from '@/components/shared/layout/PageShell';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ProjectDetailHeader } from '@/features/projects/detail/ProjectDetailHeader';
import { ProjectOverviewCard } from '@/features/projects/detail/ProjectOverviewCard';
import { RightColumnTabs } from '@/features/projects/detail/RightColumnTabs';
import { ActivityPanel } from '@/features/projects/detail/ActivityPanel';

export default function ProjectDetailPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);

  const [uploadModelId, setUploadModelId] = useState<string | null>(null);

  if (projectQuery.isLoading) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid flex-1 grid-cols-2 gap-3.5">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    const errorMessage = isNotFound
      ? 'Project not found. It may have been deleted.'
      : error instanceof ApiError
        ? error.detail
        : 'Failed to load project.';
    return (
      <main className="p-6">
        <ErrorBanner message={errorMessage} tone="soft" className="text-body2" />
      </main>
    );
  }

  const project = projectQuery.data;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  const models = modelsQuery.data ?? [];

  const uploadModel = uploadModelId !== null
    ? models.find((m) => m.id === uploadModelId)
    : undefined;

  return (
    <PageShell
      hero={
        <ProjectDetailHeader
          project={project}
        />
      }
    >
      <Dialog
        open={uploadModelId !== null}
        onOpenChange={(open) => { if (!open) setUploadModelId(null); }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {uploadModel !== undefined ? `Upload — ${uploadModel.name}` : 'Upload file'}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {uploadModelId !== null && (
              <ModelFiles
                projectId={projectId}
                modelId={uploadModelId}
                primaryFileType={uploadModel?.primary_file_type ?? null}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-hidden px-3.5 pb-3.5 xl:grid-cols-2">
        <ProjectOverviewCard project={project} />

        <div className="grid min-h-0 grid-rows-[3fr_2fr] gap-3.5">
          <RightColumnTabs
            projectId={projectId}
            projectCountry={project.country}
            models={models}
            onUpload={setUploadModelId}
          />
          <ActivityPanel projectId={projectId} />
        </div>
      </div>
    </PageShell>
  );
}
