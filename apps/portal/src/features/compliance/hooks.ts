'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import {
  getComplianceLatest,
  listProjectReports,
  triggerComplianceCheck,
} from '@/lib/api/compliance';
import type {
  ComplianceCheckResponse,
  ComplianceSummaryResponse,
  ProjectComplianceReportItem,
} from '@/lib/api/schemas';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import {
  complianceDataKey,
  complianceSummaryKey,
  complianceDomainsKey,
  complianceArticlesKey,
  issuesKey,
  projectReportsKey,
} from './queryKeys';

import type {
  ComplianceSummary,
  ComplianceDomain,
  ComplianceArticle,
  ComplianceIssue,
} from './types';

function mapToComplianceSummary(resp: ComplianceSummaryResponse): ComplianceSummary {
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const cat of resp.category_summary) {
    passCount += cat.passed;
    warnCount += cat.warned;
    failCount += cat.failed;
  }
  const total = passCount + warnCount + failCount;
  return {
    passCount,
    warnCount,
    failCount,
    overallScore: total > 0 ? Math.round((passCount / total) * 100) : 0,
    dossierPercentage: 0,
    lastScanAt: resp.checked_at,
  };
}

function mapToDomains(resp: ComplianceSummaryResponse): ComplianceDomain[] {
  return resp.category_summary.map((c) => ({
    id: c.category,
    name: c.category,
    articleCount: c.total_rules,
    pass: c.passed,
    warn: c.warned,
    fail: c.failed,
  }));
}

function mapToArticles(resp: ComplianceSummaryResponse): ComplianceArticle[] {
  return resp.rules_summary.map((r) => ({
    code: r.article,
    title: r.titles?.['nl'] ?? r.titles?.['en'] ?? r.title_nl ?? r.title ?? r.article,
    categoryId: r.category,
    checks: r.total_checked,
    pass: r.passed,
    warn: r.warned,
    fail: r.failed,
  }));
}

function mapToIssues(resp: ComplianceCheckResponse): ComplianceIssue[] {
  return resp.details
    .filter((d) => d.status === 'fail' || d.status === 'warn')
    .map((d, i) => ({
      id: `I-${String(i + 1).padStart(4, '0')}`,
      bblCode: d.article,
      severity: d.status as 'fail' | 'warn',
      objectName: d.element_name ?? d.element_global_id,
      // Em-dash sentinel (not '') so a reviewer can tell the API omitted the
      // field from the model genuinely having no value for it.
      location: d.element_type ?? '—',
      modelDiscipline: d.property_set ?? '—',
      owner: '',
      createdAt: resp.checked_at,
      requirementText: d.message,
    }));
}

export function useComplianceSummary(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceSummary> {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) => getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
    select: mapToComplianceSummary,
  });
}

export function useComplianceDomains(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceDomain[]> {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) => getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
    select: mapToDomains,
  });
}

export function useComplianceArticles(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceArticle[]> {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) => getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
    select: mapToArticles,
  });
}

export function useComplianceIssues(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceIssue[]> {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) => getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
    select: mapToIssues,
  });
}

export function useComplianceLatest(
  projectId: string,
  fileId?: string,
  modelId?: string,
  framework: 'bbl' | 'wkb' = 'bbl',
): UseQueryResult<ComplianceCheckResponse> {
  return useAuthQuery({
    queryKey: ['projects', projectId, 'compliance', 'latest', fileId ?? '', framework] as const,
    queryFn: (accessToken) => {
      if (!fileId || !modelId) throw new Error('Missing fileId or modelId');
      // This variant has its own query key (keyed by framework); the request
      // itself reuses getComplianceLatest.
      return getComplianceLatest(accessToken, projectId, modelId, fileId);
    },
    enabled: projectId.length > 0 && !!fileId && !!modelId,
  });
}

export function useProjectReports(
  projectId: string,
  framework?: 'bbl' | 'wkb',
): UseQueryResult<ProjectComplianceReportItem[]> {
  return useAuthQuery({
    queryKey: projectReportsKey(projectId, framework),
    queryFn: (accessToken) => listProjectReports(accessToken, projectId, framework),
    enabled: projectId.length > 0,
  });
}

export function useCheckCompliance(
  projectId: string,
  modelId: string,
): UseMutationResult<ComplianceCheckResponse, Error, { fileId: string; buildingType?: string }> {
  return useAuthMutation({
    mutationFn: (accessToken, { fileId, buildingType }) => triggerComplianceCheck(accessToken, projectId, modelId, fileId, buildingType),
    invalidateKeys: [
      complianceSummaryKey(projectId),
      complianceDomainsKey(projectId),
      complianceArticlesKey(projectId),
      issuesKey(projectId),
      ['projects', projectId, 'compliance'],
    ],
    onSuccess: (_response, vars) => {
      track(PORTAL_EVENTS.COMPLIANCE_CHECK_RUN, {
        project_id: projectId,
        model_id: modelId,
        file_id: vars.fileId,
        building_type: vars.buildingType ?? null,
      });
    },
  });
}
