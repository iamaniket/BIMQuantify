'use client';

import { type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import {
  createReportTemplate,
  deleteReportTemplate,
  getReportTemplateSchema,
  listReportTemplates,
  setDefaultReportTemplate,
  updateReportTemplate,
  type ReportTemplateCreateInput,
  type ReportTemplateUpdateInput,
} from '@/lib/api/reportTemplates';
import type {
  ReportTemplate,
  ReportTemplateList,
  ReportTemplateSchemaResponse,
} from '@/lib/api/schemas/reportTemplates';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { reportTemplatesKey, reportTemplateSchemaKey } from './queryKeys';

export function useReportTemplates(reportType: string): UseQueryResult<ReportTemplateList> {
  return useAuthQuery({
    queryKey: reportTemplatesKey(reportType),
    queryFn: (accessToken) => listReportTemplates(accessToken, reportType),
    enabled: reportType.length > 0,
    staleTime: 60_000,
  });
}

export function useReportTemplateSchema(
  reportType: string,
  locale: string,
): UseQueryResult<ReportTemplateSchemaResponse> {
  return useAuthQuery({
    queryKey: reportTemplateSchemaKey(reportType, locale),
    queryFn: (accessToken) => getReportTemplateSchema(accessToken, reportType, locale),
    enabled: reportType.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useCreateReportTemplate(
  reportType: string,
): UseMutationResult<ReportTemplate, Error, ReportTemplateCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createReportTemplate(accessToken, input),
    invalidateKeys: () => [reportTemplatesKey(reportType)],
  });
}

export function useUpdateReportTemplate(
  reportType: string,
): UseMutationResult<ReportTemplate, Error, { id: string; input: ReportTemplateUpdateInput }> {
  return useAuthMutation({
    mutationFn: (accessToken, { id, input }) => updateReportTemplate(accessToken, id, input),
    invalidateKeys: () => [reportTemplatesKey(reportType)],
  });
}

export function useSetDefaultReportTemplate(
  reportType: string,
): UseMutationResult<ReportTemplate, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => setDefaultReportTemplate(accessToken, id),
    invalidateKeys: () => [reportTemplatesKey(reportType)],
  });
}

export function useDeleteReportTemplate(
  reportType: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => deleteReportTemplate(accessToken, id),
    invalidateKeys: () => [reportTemplatesKey(reportType)],
  });
}
