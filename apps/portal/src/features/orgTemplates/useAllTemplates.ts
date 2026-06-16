'use client';

import { useMemo } from 'react';

import { useFindingTemplates } from '../findingTemplates/useFindingTemplates';
import { useReportTemplates } from '../reportTemplates/hooks';
import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';
import type { FindingTemplate } from '@/lib/api/schemas';
import type { ReportTemplate } from '@/lib/api/schemas/reportTemplates';

export type UnifiedTemplateRow =
  | { kind: 'finding'; data: FindingTemplate }
  | { kind: 'report'; data: ReportTemplate };

export type AllTemplatesStats = {
  totalCount: number;
  findingCount: number;
  reportCount: number;
  findingDefault: FindingTemplate | null;
  reportDefaults: Map<string, ReportTemplate | null>;
};

export function useAllTemplates() {
  const findingsQuery = useFindingTemplates();
  const complianceQuery = useReportTemplates('compliance_report');
  const assuranceQuery = useReportTemplates('assurance_plan');
  const completionQuery = useReportTemplates('completion_declaration');
  const dossierQuery = useReportTemplates('dossier');

  const reportQueries = [complianceQuery, assuranceQuery, completionQuery, dossierQuery];

  const isLoading =
    findingsQuery.isLoading || reportQueries.some((q) => q.isLoading);

  const findingTemplates = findingsQuery.data ?? [];

  const reportTemplatesByType = useMemo(() => {
    const map = new Map<string, readonly ReportTemplate[]>();
    for (let i = 0; i < REPORT_TEMPLATE_TYPES.length; i++) {
      const type = REPORT_TEMPLATE_TYPES[i]!;
      map.set(type, reportQueries[i]!.data ?? []);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complianceQuery.data, assuranceQuery.data, completionQuery.data, dossierQuery.data]);

  const allReportTemplates = useMemo(
    () => [...reportTemplatesByType.values()].flat(),
    [reportTemplatesByType],
  );

  const templates: UnifiedTemplateRow[] = useMemo(() => {
    const rows: UnifiedTemplateRow[] = [];
    for (const tpl of findingTemplates) {
      rows.push({ kind: 'finding', data: tpl });
    }
    for (const tpl of allReportTemplates) {
      rows.push({ kind: 'report', data: tpl });
    }
    return rows;
  }, [findingTemplates, allReportTemplates]);

  const stats: AllTemplatesStats = useMemo(() => {
    const reportDefaults = new Map<string, ReportTemplate | null>();
    for (const type of REPORT_TEMPLATE_TYPES) {
      const list = reportTemplatesByType.get(type) ?? [];
      reportDefaults.set(type, list.find((t) => t.is_default) ?? null);
    }
    return {
      totalCount: findingTemplates.length + allReportTemplates.length,
      findingCount: findingTemplates.length,
      reportCount: allReportTemplates.length,
      findingDefault: findingTemplates.find((t) => t.is_default) ?? null,
      reportDefaults,
    };
  }, [findingTemplates, allReportTemplates, reportTemplatesByType]);

  return { templates, isLoading, findingTemplates, allReportTemplates, stats };
}
