'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  complianceSummaryKey,
  complianceDomainsKey,
  complianceArticlesKey,
  issuesKey,
  activityKey,
  dossierKey,
  trendKey,
} from '../queryKeys';

import type {
  ComplianceSummary,
  ComplianceDomain,
  ComplianceArticle,
  ComplianceIssue,
  ActivityItem,
  DossierData,
  ComplianceTrend,
} from './types';

import {
  MOCK_COMPLIANCE_SUMMARY,
  MOCK_DOMAINS,
  MOCK_ARTICLES,
  MOCK_ISSUES,
  MOCK_ACTIVITY,
  MOCK_DOSSIER,
  MOCK_TREND,
} from './mockData';

// TODO: Replace each queryFn with real API call when backend supports compliance

export function useComplianceSummary(projectId: string): UseQueryResult<ComplianceSummary> {
  return useQuery({
    queryKey: complianceSummaryKey(projectId),
    queryFn: async () => MOCK_COMPLIANCE_SUMMARY,
    enabled: projectId.length > 0,
  });
}

export function useComplianceDomains(projectId: string): UseQueryResult<ComplianceDomain[]> {
  return useQuery({
    queryKey: complianceDomainsKey(projectId),
    queryFn: async () => MOCK_DOMAINS,
    enabled: projectId.length > 0,
  });
}

export function useComplianceArticles(projectId: string): UseQueryResult<ComplianceArticle[]> {
  return useQuery({
    queryKey: complianceArticlesKey(projectId),
    queryFn: async () => MOCK_ARTICLES,
    enabled: projectId.length > 0,
  });
}

export function useComplianceIssues(projectId: string): UseQueryResult<ComplianceIssue[]> {
  return useQuery({
    queryKey: issuesKey(projectId),
    queryFn: async () => MOCK_ISSUES,
    enabled: projectId.length > 0,
  });
}

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
