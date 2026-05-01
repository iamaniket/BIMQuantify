'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, Skeleton } from '@bimstitch/ui';

import { ModelFiles } from '@/features/projects/ModelFiles';

import { ApiError } from '@/lib/api/client';
import { useModels } from '@/features/projects/useModels';
import { useProject } from '@/features/projects/useProject';
import {
  useComplianceSummary,
  useComplianceDomains,
  useComplianceArticles,
  useComplianceIssues,
  useProjectActivity,
  useProjectDossier,
  useComplianceTrend,
} from '@/features/projects/compliance/hooks';
import { useAuth } from '@/providers/AuthProvider';

import { ProjectDetailHeader } from '@/features/projects/detail/ProjectDetailHeader';
import { ComplianceHealthCard } from '@/features/projects/detail/ComplianceHealthCard';
import { ComplianceByDomainCard } from '@/features/projects/detail/ComplianceByDomainCard';
import { RightColumnTabs } from '@/features/projects/detail/RightColumnTabs';

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
  const issuesQuery = useComplianceIssues(projectId);
  const activityQuery = useProjectActivity(projectId);
  const dossierQuery = useProjectDossier(projectId);
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
  const issues = issuesQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const dossier = dossierQuery.data;
  const trend = trendQuery.data ?? [];
  const overallScore = summary?.overallScore ?? 0;
  const dossierPct = summary?.dossierPercentage ?? 0;

  const uploadModel = uploadModelId !== null
    ? models.find((m) => m.id === uploadModelId)
    : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
              <ModelFiles projectId={projectId} modelId={uploadModelId} />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ProjectDetailHeader
        project={project}
        compliance={summary}
        issueCount={issues.length}
        dossierPct={dossierPct}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3.5 overflow-y-auto p-3.5">
        {/* Left column */}
        <div className="flex flex-col gap-3.5">
          <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            {summary !== undefined && (
              <ComplianceHealthCard
                summary={summary}
                holdbackAmount={dossier?.holdbackAmount ?? '—'}
                embedded
              />
            )}
            <div className="border-t border-border" />
            <ComplianceByDomainCard
              domains={domains}
              articles={articles}
              models={models}
              trend={trend}
              overallScore={overallScore}
              totalChecks={summary !== undefined ? summary.passCount + summary.warnCount + summary.failCount : 0}
              failCount={summary?.failCount ?? 0}
              embedded
            />
          </div>
        </div>

        {/* Right column */}
        <RightColumnTabs
          projectId={projectId}
          models={models}
          issues={issues}
          activity={activity}
          dossier={dossier}
          onUpload={setUploadModelId}
        />
      </div>
    </div>
  );
}
