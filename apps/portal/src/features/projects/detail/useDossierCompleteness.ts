'use client';

import { useMemo } from 'react';

import { useAttachments } from '@/features/attachments/useAttachments';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useFindings } from '@/features/findings/useFindings';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import { isDocumentViewable } from '@/features/documents/documentViewability';
import { useDocumentsWithVersions } from '@/features/documents/useDocumentsWithVersions';
import { useProject } from '@/features/projects/useProject';
import { flattenPages } from '@/lib/query/useAuthInfiniteQuery';

import {
  computeDossierCompleteness,
  selectDossierTemplate,
  type DossierCompleteness,
} from './dossierTemplate';
import { useDeadlines } from './deadlines/useDeadlines';

type DossierCompletenessState = DossierCompleteness & {
  /** True once the queries are in flight — the percentage is not yet meaningful. */
  isLoading: boolean;
  /** No requirement template for this jurisdiction/building type. */
  templateEmpty: boolean;
  /** At least one model exists (viewable or not) — drives the Drawings CTA. */
  hasAnyModel: boolean;
};

/**
 * Resolve the project's dossier completeness from its jurisdiction template,
 * tagged documents, certificates, and derived signals (models / findings /
 * deadlines). Shared by the Readiness header (headline percentage) and the
 * checklist tab (per-requirement rows); the underlying React Query reads dedupe
 * so calling it from both places costs nothing extra.
 */
export function useDossierCompleteness(
  projectId: string,
  country: string,
): DossierCompletenessState {
  const projectQuery = useProject(projectId);
  const jurisdiction = useJurisdiction(country);
  const attachmentsQuery = useAttachments(projectId);
  const certificatesQuery = useCertificates(projectId);
  // Versions are needed to know which models have a viewable/processed file
  // (what fulfils the model-backed Drawings slot). Polls while extracting so
  // the checklist flips to met without a manual refresh.
  const modelsQuery = useDocumentsWithVersions(projectId, true);
  const findingsQuery = useFindings(projectId);
  const deadlinesQuery = useDeadlines(projectId);

  const buildingType = projectQuery.data?.building_type ?? null;
  const attachments = flattenPages(attachmentsQuery.data);
  const certificates = flattenPages(certificatesQuery.data);

  const models = modelsQuery.data;
  const modelCount = models?.length ?? 0;
  const viewableModelCount = useMemo(
    () => (models ?? []).filter((m) => isDocumentViewable(m.versions)).length,
    [models],
  );

  const template = useMemo(
    () => selectDossierTemplate(jurisdiction?.dossier_requirement_templates, buildingType),
    [jurisdiction, buildingType],
  );

  const allFindings = flattenPages(findingsQuery.data);
  const findingsOpen = useMemo(
    () => allFindings.filter((f) => f.status !== 'resolved' && f.status !== 'verified').length,
    [allFindings],
  );
  const deadlinesOverdue = useMemo(
    () => (deadlinesQuery.data ?? []).filter((d) => d.is_overdue).length,
    [deadlinesQuery.data],
  );

  const dossier = useMemo(
    () =>
      computeDossierCompleteness(template, attachments, certificates, {
        modelCount,
        viewableModelCount,
        findingsOpen,
        deadlinesOverdue,
      }),
    [template, attachments, certificates, modelCount, viewableModelCount, findingsOpen, deadlinesOverdue],
  );

  return {
    ...dossier,
    isLoading:
      projectQuery.isLoading || attachmentsQuery.isLoading || certificatesQuery.isLoading,
    templateEmpty: template.length === 0,
    hasAnyModel: modelCount > 0,
  };
}
