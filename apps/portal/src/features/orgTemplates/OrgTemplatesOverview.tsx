'use client';

import {
  Award,
  CheckCircle,
  FileText,
  LayoutGrid,
  SlidersHorizontal,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge, Card, CardBody } from '@bimstitch/ui';

import type { FindingTemplate } from '@/lib/api/schemas';
import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';
import type { ReportTemplate } from '@/lib/api/schemas/reportTemplates';
import type { AllTemplatesStats } from './useAllTemplates';

type Props = {
  findingTemplates: FindingTemplate[];
  reportTemplates: ReportTemplate[];
  stats: AllTemplatesStats;
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

  const reportDefaultsCount = useMemo(() => {
    let count = 0;
    for (const type of REPORT_TEMPLATE_TYPES) {
      if (stats.reportDefaults.get(type) != null) count++;
    }
    return count;
  }, [stats.reportDefaults]);

  const reportsByType = useMemo(() => {
    const map = new Map<string, ReportTemplate[]>();
    for (const type of REPORT_TEMPLATE_TYPES) {
      map.set(type, []);
    }
    for (const tpl of reportTemplates) {
      const list = map.get(tpl.template_type);
      if (list !== undefined) list.push(tpl);
    }
    return map;
  }, [reportTemplates]);

  return (
    <div className="flex flex-col gap-6">
      {/* Finding templates section */}
      <section>
        <h3 className="mb-3 text-body2 font-bold text-foreground">
          {t('overview.findingsSection')}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<LayoutGrid className="h-4 w-4" />}
            value={String(stats.findingCount)}
            label={t('overview.totalFindingTemplates')}
          />
          <StatCard
            icon={<SlidersHorizontal className="h-4 w-4" />}
            value={String(totalFindingFields)}
            label={t('overview.totalFields')}
          />
          <StatCard
            icon={<Award className="h-4 w-4" />}
            value={stats.findingDefault?.name ?? t('overview.noDefaultSet')}
            label={t('overview.defaultTemplate')}
            isText
          />
        </div>
        {findingTemplates.length > 0 && (
          <div className="mt-3 grid gap-2">
            {findingTemplates.map((tpl) => (
              <Card key={tpl.id}>
                <CardBody>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{tpl.name}</span>
                    <div className="flex items-center gap-2">
                      {tpl.is_default && (
                        <Badge variant="success" size="md">{t('table.defaultBadge')}</Badge>
                      )}
                      <span className="font-sans text-caption tabular-nums text-foreground-tertiary">
                        {t('overview.fieldCount', { count: tpl.fields.length })}
                      </span>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Report templates section */}
      <section>
        <h3 className="mb-3 text-body2 font-bold text-foreground">
          {t('overview.reportsSection')}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            icon={<FileText className="h-4 w-4" />}
            value={String(stats.reportCount)}
            label={t('overview.totalReportTemplates')}
          />
          <StatCard
            icon={<CheckCircle className="h-4 w-4" />}
            value={`${reportDefaultsCount} / ${REPORT_TEMPLATE_TYPES.length}`}
            label={t('overview.reportDefaults')}
          />
        </div>
        {reportTemplates.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {REPORT_TEMPLATE_TYPES.map((type) => {
              const list = reportsByType.get(type) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={type}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-body3 font-medium text-foreground-secondary">
                      {rt(`reportTypes.${type}` as Parameters<typeof rt>[0])}
                    </span>
                    <span className="font-sans text-caption tabular-nums text-foreground-tertiary">
                      ({list.length})
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {list.map((tpl) => (
                      <Card key={tpl.id}>
                        <CardBody>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-foreground">{tpl.name}</span>
                            {tpl.is_default && (
                              <Badge variant="success" size="md">{t('table.defaultBadge')}</Badge>
                            )}
                          </div>
                          {tpl.description !== null && (
                            <p className="mt-0.5 truncate font-sans text-caption text-foreground-tertiary">
                              {tpl.description}
                            </p>
                          )}
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 font-sans text-body3 text-foreground-tertiary">
            {t('overview.noReportTemplates')}
          </p>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  isText,
}: {
  icon: JSX.Element;
  value: string;
  label: string;
  isText?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface-low p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
          {icon}
        </div>
        <div>
          <div className={isText ? 'truncate text-body2 font-bold' : 'text-h4 font-extrabold tabular-nums'}>
            {value}
          </div>
          <div className="text-caption text-foreground-tertiary">{label}</div>
        </div>
      </div>
    </div>
  );
}
