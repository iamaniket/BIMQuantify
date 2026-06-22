'use client';

import {
  FileText,
  Hash,
  Layers,
  LayoutGrid,
  ListTree,
  SlidersHorizontal,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { ChartBarRow } from '@/components/shared/charts/ChartBarRow';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import type { FindingTemplate } from '@/lib/api/schemas';
import { FINDING_FIELD_TYPES, type FindingFieldTypeValue } from '@/lib/api/schemas/findingTemplates';
import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';
import type { ReportTemplate } from '@/lib/api/schemas/reportTemplates';

import type { AllTemplatesStats } from './useAllTemplates';

type Props = {
  findingTemplates: FindingTemplate[];
  reportTemplates: ReportTemplate[];
  stats: AllTemplatesStats;
};

// One color per custom field type — reused for donut + legend.
const FIELD_TYPE_COLORS: Record<FindingFieldTypeValue, string> = {
  text: 'var(--primary)',
  textarea: 'var(--info)',
  number: 'var(--warning)',
  date: 'var(--success)',
  select: 'var(--primary-hover)',
  checkbox: 'var(--foreground-tertiary)',
};

export function OrgTemplatesOverview({
  findingTemplates,
  reportTemplates,
  stats,
}: Props): JSX.Element {
  const t = useTranslations('orgTemplates');
  const rt = useTranslations('reportTemplates');

  const totalFindingFields = useMemo(
    () => findingTemplates.reduce((sum, tpl) => sum + tpl.fields.length, 0),
    [findingTemplates],
  );

  const reportsByType = useMemo(() => {
    const map = new Map<string, ReportTemplate[]>();
    for (const type of REPORT_TEMPLATE_TYPES) map.set(type, []);
    for (const tpl of reportTemplates) {
      const list = map.get(tpl.template_type);
      if (list !== undefined) list.push(tpl);
    }
    return map;
  }, [reportTemplates]);

  // Templates by type — Finding bucket + one per report type.
  const typeCategories = useMemo(() => {
    const cats = [t('overview.findingType')];
    for (const rtype of REPORT_TEMPLATE_TYPES) cats.push(rt(`reportTypes.${rtype}`));
    return cats;
  }, [t, rt]);
  const typeValues = useMemo(() => {
    const vals = [stats.findingCount];
    for (const rtype of REPORT_TEMPLATE_TYPES) {
      const list = reportsByType.get(rtype);
      vals.push(list !== undefined ? list.length : 0);
    }
    return vals;
  }, [stats.findingCount, reportsByType]);

  // Custom-field-type distribution across all finding templates.
  const fieldTypeCounts = useMemo(() => {
    const counts: Record<FindingFieldTypeValue, number> = {
      text: 0, textarea: 0, number: 0, date: 0, select: 0, checkbox: 0,
    };
    for (const tpl of findingTemplates) {
      for (const f of tpl.fields) counts[f.type] += 1;
    }
    return counts;
  }, [findingTemplates]);

  const fieldTypeSegments = useMemo<DonutSegment[]>(
    () => FINDING_FIELD_TYPES.map((ft) => ({
      value: fieldTypeCounts[ft],
      color: FIELD_TYPE_COLORS[ft],
      label: t(`overview.fieldType.${ft}`),
    })),
    [fieldTypeCounts, t],
  );

  // Fields per finding template — busiest first; bar width relative to the max.
  const fieldsPerTemplate = useMemo(() => {
    const rows = findingTemplates
      .map((tpl) => ({ id: tpl.id, name: tpl.name, count: tpl.fields.length }))
      .sort((a, b) => b.count - a.count);
    const max = rows.reduce((m, r) => Math.max(m, r.count), 1);
    return { rows, max };
  }, [findingTemplates]);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('overview.totalTemplates')}
          value={stats.totalCount}
          icon={<Layers className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('overview.totalFindingTemplates')}
          value={stats.findingCount}
          icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('overview.totalReportTemplates')}
          value={stats.reportCount}
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('overview.totalFields')}
          value={totalFindingFields}
          icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Templates by type */}
        <ChartSection icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('overview.byTypeTitle')}>
          {stats.totalCount === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.noReportTemplates')}</p>
          ) : (
            <BarChartMini categories={typeCategories} values={typeValues} height={200} />
          )}
        </ChartSection>

        {/* Field types in use */}
        <ChartSection icon={<SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />} title={t('overview.fieldTypesTitle')}>
          {totalFindingFields === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.noFields')}</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={fieldTypeSegments}
                centerValue={String(totalFindingFields)}
                centerLabel={t('overview.fieldsDonutCenter')}
                size={180}
              />
              <ul className="flex min-w-0 flex-1 flex-col gap-2">
                {FINDING_FIELD_TYPES.filter((ft) => fieldTypeCounts[ft] > 0).map((ft) => (
                  <li key={ft} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: FIELD_TYPE_COLORS[ft] }} />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{t(`overview.fieldType.${ft}`)}</span>
                    <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{fieldTypeCounts[ft]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartSection>

        {/* Custom fields per template */}
        <ChartSection
          icon={<Hash className="h-3.5 w-3.5" aria-hidden />}
          title={t('overview.fieldsPerTemplateTitle')}
          className="lg:col-span-2"
        >
          {fieldsPerTemplate.rows.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.noFindingTemplates')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {fieldsPerTemplate.rows.map((row) => (
                <ChartBarRow
                  key={row.id}
                  label={row.name}
                  count={row.count}
                  total={fieldsPerTemplate.max}
                  color="var(--primary)"
                />
              ))}
            </div>
          )}
        </ChartSection>

        {/* Report templates by type */}
        <ChartSection
          icon={<ListTree className="h-3.5 w-3.5" aria-hidden />}
          title={t('overview.reportsSection')}
          className="lg:col-span-2"
        >
          {reportTemplates.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('overview.noReportTemplates')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {REPORT_TEMPLATE_TYPES.map((type) => {
                const list = reportsByType.get(type) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-body3 font-medium text-foreground-secondary">
                        {rt(`reportTypes.${type}`)}
                      </span>
                      <span className="font-sans text-caption tabular-nums text-foreground-tertiary">({list.length})</span>
                    </div>
                    <div className="grid gap-1.5">
                      {list.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">{tpl.name}</span>
                          {tpl.is_default && (
                            <Badge variant="success" size="md">{t('table.defaultBadge')}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ChartSection>
      </div>
    </div>
  );
}
