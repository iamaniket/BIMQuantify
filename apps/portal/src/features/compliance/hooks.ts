'use client';

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

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
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import { useAuth } from '@/providers/AuthProvider';

import {
  complianceDataKey,
  complianceSummaryKey,
  complianceDomainsKey,
  complianceArticlesKey,
  issuesKey,
  activityKey,
  dossierKey,
  trendKey,
  projectReportsKey,
} from './queryKeys';

import type {
  ComplianceSummary,
  ComplianceDomain,
  ComplianceArticle,
  ComplianceIssue,
  ActivityItem,
  DossierData,
  ComplianceTrend,
} from './types.js';

import {
  MOCK_ACTIVITY,
  MOCK_DOSSIER,
  MOCK_TREND,
} from './mockData';

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
      location: d.element_type ?? '',
      modelDiscipline: d.property_set ?? '',
      owner: '',
      createdAt: resp.checked_at,
      requirementText: d.message,
    }));
}

function useComplianceData(
  projectId: string,
  fileId?: string,
  modelId?: string,
) {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) =>
      getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
  });
}

export function useComplianceSummary(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceSummary> {
  return useAuthQuery({
    queryKey: complianceDataKey(projectId, fileId, modelId),
    queryFn: (accessToken) =>
      getComplianceLatest(accessToken, projectId, modelId!, fileId!),
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
    queryFn: (accessToken) =>
      getComplianceLatest(accessToken, projectId, modelId!, fileId!),
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
    queryFn: (accessToken) =>
      getComplianceLatest(accessToken, projectId, modelId!, fileId!),
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
    queryFn: (accessToken) =>
      getComplianceLatest(accessToken, projectId, modelId!, fileId!),
    enabled: projectId.length > 0 && !!fileId && !!modelId,
    select: mapToIssues,
  });
}

export function useProjectActivity(projectId: string): UseQueryResult<ActivityItem[]> {
  return useAuthQuery({
    queryKey: activityKey(projectId),
    queryFn: async () => MOCK_ACTIVITY,
    enabled: projectId.length > 0,
  });
}

export function useProjectDossier(projectId: string): UseQueryResult<DossierData> {
  return useAuthQuery({
    queryKey: dossierKey(projectId),
    queryFn: async () => MOCK_DOSSIER,
    enabled: projectId.length > 0,
  });
}

export function useComplianceTrend(projectId: string): UseQueryResult<ComplianceTrend> {
  return useAuthQuery({
    queryKey: trendKey(projectId),
    queryFn: async () => MOCK_TREND,
    enabled: projectId.length > 0,
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
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest?framework=${framework}`;
      // This variant uses framework param so it has its own query key
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
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileId, buildingType }) => {
      if (!tokens) throw new Error('Not authenticated');
      return triggerComplianceCheck(
        tokens.access_token,
        projectId,
        modelId,
        fileId,
        buildingType,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: complianceSummaryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: complianceDomainsKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: complianceArticlesKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: issuesKey(projectId) });
      void queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'compliance'],
      });
    },
  });
}
