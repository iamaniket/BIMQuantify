'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client.js';
import {
  ComplianceCheckResponseSchema,
  ComplianceSummaryResponseSchema,
  type ComplianceCheckResponse,
  type ComplianceSummaryResponse,
} from '@/lib/api/schemas.js';
import { useAuth } from '@/providers/AuthProvider.js';

import {
  complianceSummaryKey,
  complianceDomainsKey,
  complianceArticlesKey,
  issuesKey,
  activityKey,
  dossierKey,
  trendKey,
} from '../queryKeys.js';

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
} from './mockData.js';

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
  const CATEGORY_LABELS: Record<string, string> = {
    fire_safety: 'Brandveiligheid',
    structural: 'Constructie',
    usability: 'Bruikbaarheid',
    health: 'Gezondheid',
    accessibility: 'Toegankelijkheid',
    sustainability: 'Duurzaamheid',
  };
  return resp.category_summary.map((c) => ({
    id: c.category,
    name: CATEGORY_LABELS[c.category] ?? c.category,
    articleCount: c.total_rules,
    pass: c.passed,
    warn: c.warned,
    fail: c.failed,
  }));
}

function mapToArticles(resp: ComplianceSummaryResponse): ComplianceArticle[] {
  const CATEGORY_LABELS: Record<string, string> = {
    fire_safety: 'Brandveiligheid',
    structural: 'Constructie',
    usability: 'Bruikbaarheid',
    health: 'Gezondheid',
    accessibility: 'Toegankelijkheid',
    sustainability: 'Duurzaamheid',
  };
  return resp.rules_summary.map((r) => ({
    code: r.article,
    title: r.title_nl,
    group: CATEGORY_LABELS[r.category] ?? r.category,
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

export function useComplianceSummary(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceSummary> {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: complianceSummaryKey(projectId),
    queryFn: async () => {
      if (!fileId || !modelId || !tokens) {
        throw new Error('Missing fileId, modelId, or tokens');
      }
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest`;
      const resp = await apiClient.get(path, ComplianceSummaryResponseSchema, tokens.access_token);
      return mapToComplianceSummary(resp);
    },
    enabled: projectId.length > 0 && !!fileId && !!modelId && !!tokens,
  });
}

export function useComplianceDomains(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceDomain[]> {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: complianceDomainsKey(projectId),
    queryFn: async () => {
      if (!fileId || !modelId || !tokens) {
        throw new Error('Missing fileId, modelId, or tokens');
      }
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest`;
      const resp = await apiClient.get(path, ComplianceSummaryResponseSchema, tokens.access_token);
      return mapToDomains(resp);
    },
    enabled: projectId.length > 0 && !!fileId && !!modelId && !!tokens,
  });
}

export function useComplianceArticles(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceArticle[]> {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: complianceArticlesKey(projectId),
    queryFn: async () => {
      if (!fileId || !modelId || !tokens) {
        throw new Error('Missing fileId, modelId, or tokens');
      }
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest`;
      const resp = await apiClient.get(path, ComplianceSummaryResponseSchema, tokens.access_token);
      return mapToArticles(resp);
    },
    enabled: projectId.length > 0 && !!fileId && !!modelId && !!tokens,
  });
}

export function useComplianceIssues(
  projectId: string,
  fileId?: string,
  modelId?: string,
): UseQueryResult<ComplianceIssue[]> {
  const { tokens } = useAuth();
  return useQuery({
    queryKey: issuesKey(projectId),
    queryFn: async () => {
      if (!fileId || !modelId || !tokens) {
        throw new Error('Missing fileId, modelId, or tokens');
      }
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest`;
      const resp = await apiClient.get(path, ComplianceCheckResponseSchema, tokens.access_token);
      return mapToIssues(resp);
    },
    enabled: projectId.length > 0 && !!fileId && !!modelId && !!tokens,
  });
}

// Activity, dossier, and trend remain mock until those features are built
export function useProjectActivity(projectId: string): UseQueryResult<ActivityItem[]> {
  return useQuery({
    queryKey: activityKey(projectId),
    queryFn: async () => MOCK_ACTIVITY,
    enabled: projectId.length > 0,
  });
}

export function useProjectDossier(projectId: string): UseQueryResult<DossierData> {
  return useQuery({
    queryKey: dossierKey(projectId),
    queryFn: async () => MOCK_DOSSIER,
    enabled: projectId.length > 0,
  });
}

export function useComplianceTrend(projectId: string): UseQueryResult<ComplianceTrend> {
  return useQuery({
    queryKey: trendKey(projectId),
    queryFn: async () => MOCK_TREND,
    enabled: projectId.length > 0,
  });
}

// ── Mutation: trigger a new compliance check ──

export function useCheckCompliance(
  projectId: string,
  modelId: string,
): UseMutationResult<ComplianceCheckResponse, Error, { fileId: string; buildingType?: string }> {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileId, buildingType = 'all' }) => {
      if (!tokens) throw new Error('Not authenticated');
      const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/check`;
      return apiClient.post(
        path,
        { building_type: buildingType },
        ComplianceCheckResponseSchema,
        tokens.access_token,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: complianceSummaryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: complianceDomainsKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: complianceArticlesKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: issuesKey(projectId) });
    },
  });
}
