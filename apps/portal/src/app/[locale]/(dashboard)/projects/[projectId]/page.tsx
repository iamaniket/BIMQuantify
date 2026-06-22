'use client';

import { useParams } from 'next/navigation';

import { useEffect, useMemo, useState, type JSX } from 'react';

import { Button, Skeleton } from '@bimstitch/ui';
import { Pencil, Settings, Share2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';

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
import {
  computeDossierCompleteness,
  selectDossierTemplate,
} from '@/features/projects/detail/dossierTemplate';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { ProjectSettingsDialog } from '@/features/projects/detail/ProjectSettingsDialog';
import { isProjectArchived } from '@/lib/formatting/projects';
import { Link } from '@/i18n/navigation';

export default function ProjectDetailPage(): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const tHero = useTranslations('projectDetail.hero');
  const projectQuery = useProject(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    track(PORTAL_EVENTS.PROJECT_OPENED, { project_id: projectId });
  }, [projectId]);
  const modelsQuery = useModels(projectId);
  const deadlinesQuery = useDeadlines(projectId);
  const attachmentsQuery = useAttachments(projectId);
  const findingsQuery = useFindings(projectId);
  const certificatesQuery = useCertificates(projectId);

  const deadlines = deadlinesQuery.data ?? [];
  const attachments = flattenPages(attachmentsQuery.data);
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

  const heroAction = (
    <>
      <Button
        variant="border"
        disabled={isProjectArchived(project)}
        onClick={() => { setEditOpen(true); }}
      >
        <Pencil className="mr-1 h-3.5 w-3.5" />
        {tHero('editProject')}
      </Button>
      <Button
        variant="border"
        disabled={isProjectArchived(project)}
        onClick={() => { setSettingsOpen(true); }}
      >
        <Settings className="mr-1 h-3.5 w-3.5" />
        {tHero('settings')}
      </Button>
      <Button variant="border" size="md" asChild>
        <Link href={`/projects/${project.id}/access`}>
          <Share2 className="mr-1 h-3.5 w-3.5" /> {tHero('projectAccess')}
        </Link>
      </Button>
    </>
  );

  return (
    <>
      <PageShell
        hero={
          <ProjectDetailHeader
            project={project}
            deadlinesSummary={deadlinesSummary}
            attachmentCount={attachmentCount}
            dossierPct={dossier.pct}
            action={heroAction}
          />
        }
      >
        <div className="grid min-h-0 flex-1 grid-rows-[1fr_2fr] grid-cols-1 gap-3.5 overflow-hidden px-3.5 pb-3.5 lg:grid-rows-1 lg:grid-cols-[1fr_1fr] xl:grid-cols-[3fr_3fr_2fr]">
          <ProjectChartsPanel dossier={dossier} />

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
      <ProjectFormDialog
        mode="edit"
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ProjectSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        projectId={projectId}
      />
    </>
  );
}
