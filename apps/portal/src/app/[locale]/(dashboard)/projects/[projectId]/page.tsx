'use client';

import { useParams } from 'next/navigation';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useState, type JSX } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, Skeleton } from '@bimstitch/ui';

import { ModelFiles } from '@/features/models/ModelFiles';

import { ApiError } from '@/lib/api/client';
import { useModels } from '@/features/models/useModels';
import { useProject } from '@/features/projects/useProject';
import {
  useComplianceSummary,
  useComplianceDomains,
  useComplianceArticles,
  useComplianceTrend,
} from '@/features/compliance/hooks';
import { useAuth } from '@/providers/AuthProvider';

import { PageShell } from '@/components/layout/PageShell';
import { ProjectDetailHeader } from '@/features/projects/detail/ProjectDetailHeader';
import { ComplianceByDomainCard } from '@/features/projects/detail/ComplianceByDomainCard';
import { RightColumnTabs } from '@/features/projects/detail/RightColumnTabs';
import { ActivityPanel } from '@/features/projects/detail/ActivityPanel';

export default function ProjectDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;

  const { setTokens } = useAuth();
  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);
  const summaryQuery = useComplianceSummary(projectId);
  const domainsQuery = useComplianceDomains(projectId);
  const articlesQuery = useComplianceArticles(projectId);
  const trendQuery = useComplianceTrend(projectId);

  const [uploadModelId, setUploadModelId] = useState<string | null>(null);

  const isUnauthorized =
    projectQuery.isError &&
    projectQuery.error instanceof ApiError &&
    (projectQuery.error.status === 401 || projectQuery.error.status === 403);

  useEffect(() => {
    if (isUnauthorized) {
      setTokens(null);
      router.replace('/login');
    }
  }, [isUnauthorized, setTokens, router]);

  if (isUnauthorized) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

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
  const summary = summaryQuery.data;
  const domains = domainsQuery.data ?? [];
  const articles = articlesQuery.data ?? [];
  const trend = trendQuery.data ?? [];
  const overallScore = summary?.overallScore ?? 0;
  const dossierPct = summary?.dossierPercentage ?? 0;

  const uploadModel = uploadModelId !== null
    ? models.find((m) => m.id === uploadModelId)
    : undefined;

  return (
    <PageShell
      hero={
        <ProjectDetailHeader
          project={project}
          compliance={summary}
          issueCount={0}
          dossierPct={dossierPct}
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 px-3.5 pb-3.5 xl:grid-cols-2">
        <ComplianceByDomainCard
          domains={domains}
          articles={articles}
          models={models}
          trend={trend}
          overallScore={overallScore}
          totalChecks={summary !== undefined ? summary.passCount + summary.warnCount + summary.failCount : 0}
          failCount={summary?.failCount ?? 0}
        />

        <div className="grid min-h-0 grid-rows-[3fr_2fr] gap-3.5">
          <RightColumnTabs
            projectId={projectId}
            projectCountry={project.country}
            models={models}
            onUpload={setUploadModelId}
          />
          <ActivityPanel />
        </div>
      </div>
    </PageShell>
  );
}
