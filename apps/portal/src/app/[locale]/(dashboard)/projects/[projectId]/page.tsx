'use client';

import { useParams } from 'next/navigation';

import { useEffect, useMemo, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { ApiError } from '@/lib/api/client';
import { useModels } from '@/features/models/useModels';
import { useProject } from '@/features/projects/useProject';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useFindings } from '@/features/findings/useFindings';
import { useCertificates } from '@/features/certificates/useCertificates';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';
import { PageShell } from '@/components/shared/layout/PageShell';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { ProjectDetailHeader } from '@/features/projects/detail/ProjectDetailHeader';
import { ProjectChartsPanel } from '@/features/projects/detail/ProjectChartsPanel';
import { RightColumnTabs } from '@/features/projects/detail/RightColumnTabs';
import { ActivityPanel } from '@/features/projects/detail/ActivityPanel';
import { useDeadlines } from '@/features/projects/detail/deadlines/useDeadlines';
import { useProjectActivity } from '@/features/projects/detail/useProjectActivity';
import {
  computeDossierCompleteness,
  selectDossierTemplate,
} from '@/features/projects/detail/dossierTemplate';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';

export default function ProjectDetailPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const projectQuery = useProject(projectId);

  useEffect(() => {
    track(PORTAL_EVENTS.PROJECT_OPENED, { project_id: projectId });
  }, [projectId]);
  const modelsQuery = useModels(projectId);
  const deadlinesQuery = useDeadlines(projectId);
  const attachmentsQuery = useAttachments(projectId);
  const activityQuery = useProjectActivity(projectId);
  const findingsQuery = useFindings(projectId);
  const certificatesQuery = useCertificates(projectId);

  const deadlines = deadlinesQuery.data ?? [];
  const attachments = flattenPages(attachmentsQuery.data);
  const activityEntries = flattenPages(activityQuery.data);
  const findings = flattenPages(findingsQuery.data);
  const certificates = flattenPages(certificatesQuery.data);

  const deadlinesSummary = useMemo(() => {
    let met = 0;
    let overdue = 0;
    for (const d of deadlines) {
      if (d.status === 'met') met++;
      else if (d.is_overdue) overdue++;
    }
    return { met, total: deadlines.length, overdue };
  }, [deadlines]);

  const attachmentCount = useMemo(
    () => attachments.filter((a) => a.status === 'ready').length,
    [attachments],
  );

  const modelCount = modelsQuery.data?.length ?? 0;
  const findingsOpen = useMemo(
    () => findings.filter((f) => f.status !== 'resolved' && f.status !== 'verified').length,
    [findings],
  );

  const buildingType = projectQuery.data?.building_type ?? null;
  const jurisdiction = useJurisdiction(projectQuery.data?.country);

  const dossierTemplate = useMemo(
    () => selectDossierTemplate(jurisdiction?.dossier_requirement_templates, buildingType),
    [jurisdiction, buildingType],
  );

  const dossier = useMemo(
    () => computeDossierCompleteness(dossierTemplate, attachments, certificates, {
      modelCount,
      findingsOpen,
      deadlinesOverdue: deadlinesSummary.overdue,
    }),
    [dossierTemplate, attachments, certificates, modelCount, findingsOpen, deadlinesSummary.overdue],
  );

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

  return (
    <PageShell
      hero={
        <ProjectDetailHeader
          project={project}
          deadlinesSummary={deadlinesSummary}
          attachmentCount={attachmentCount}
          dossierPct={dossier.pct}
        />
      }
    >
      <div className="grid min-h-0 flex-1 grid-rows-[1fr_2fr] grid-cols-1 gap-3.5 overflow-hidden px-3.5 pb-3.5 lg:grid-rows-1 lg:grid-cols-[2fr_3fr] xl:grid-cols-[2fr_4fr_2fr]">
        <ProjectChartsPanel
          dossier={dossier}
          template={dossierTemplate}
          deadlines={deadlines}
          attachments={attachments}
          certificates={certificates}
          activityEntries={activityEntries}
        />

        <RightColumnTabs
          projectId={projectId}
          projectCountry={project.country}
          models={models}
        />
        <div className="hidden lg:block">
          <ActivityPanel projectId={projectId} />
        </div>
      </div>
    </PageShell>
  );
}
