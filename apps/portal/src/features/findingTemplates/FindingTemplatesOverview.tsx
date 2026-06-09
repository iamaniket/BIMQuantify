'use client';

import {
  Award,
  CalendarClock,
  CheckCircle,
  FileText,
  LayoutGrid,
  ListFilter,
  Pencil,
  Ruler,
  SlidersHorizontal,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge, Card, CardBody, CardHeader } from '@bimstitch/ui';

import type { FindingTemplate } from '@/lib/api/schemas';
import type { FindingFieldTypeValue } from '@/lib/api/schemas/findingTemplates';

type Props = {
  templates: FindingTemplate[];
};

const FIELD_TYPE_ICON: Record<FindingFieldTypeValue, typeof Pencil> = {
  text: Pencil,
  textarea: FileText,
  number: Ruler,
  date: CalendarClock,
  select: ListFilter,
  checkbox: CheckCircle,
};

export function FindingTemplatesOverview({ templates }: Props): JSX.Element {
  const t = useTranslations('findingTemplates.overview');

  const totalFields = useMemo(
    () => templates.reduce((sum, tpl) => sum + tpl.fields.length, 0),
    [templates],
  );

  const defaultName = useMemo(
    () => templates.find((tpl) => tpl.is_default)?.name ?? null,
    [templates],
  );

  const fieldTypeCounts = useMemo(() => {
    const counts: Partial<Record<FindingFieldTypeValue, number>> = {};
    for (const tpl of templates) {
      for (const f of tpl.fields) {
        counts[f.type] = (counts[f.type] ?? 0) + 1;
      }
    }
    return counts;
  }, [templates]);

  const usedTypes = (Object.keys(fieldTypeCounts) as FindingFieldTypeValue[]).sort(
    (a, b) => (fieldTypeCounts[b] ?? 0) - (fieldTypeCounts[a] ?? 0),
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{templates.length}</div>
              <div className="text-caption text-foreground-tertiary">{t('totalTemplates')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{totalFields}</div>
              <div className="text-caption text-foreground-tertiary">{t('totalFields')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <Award className="h-4 w-4" />
            </div>
            <div>
              <div className="truncate text-body2 font-bold">
                {defaultName ?? t('noDefaultSet')}
              </div>
              <div className="text-caption text-foreground-tertiary">{t('defaultTemplate')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {templates.length > 0 && (
          <div className="grid gap-3">
            {templates.map((tpl) => (
              <Card key={tpl.id}>
                <CardBody>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{tpl.name}</span>
                    {tpl.is_default && (
                      <Badge variant="success" size="sm">
                        {t('defaultBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-sans text-caption text-foreground-tertiary">
                    {t('fieldCount', { count: tpl.fields.length })}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {/* Field types in use */}
        {usedTypes.length > 0 && (
          <Card>
            <CardHeader>
              <h3 className="text-body2 font-bold">{t('fieldTypesTitle')}</h3>
            </CardHeader>
            <CardBody className="space-y-0 p-0">
              <div className="divide-y divide-border">
                {usedTypes.map((type) => {
                  const Icon = FIELD_TYPE_ICON[type];
                  return (
                    <div key={type} className="flex items-center justify-between px-5 py-2.5">
                      <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                        <Icon className="h-3.5 w-3.5 text-foreground-tertiary" />
                        {t(`fieldType_${type}`)}
                      </div>
                      <span className="font-sans text-body3 tabular-nums text-foreground-tertiary">
                        {fieldTypeCounts[type]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
