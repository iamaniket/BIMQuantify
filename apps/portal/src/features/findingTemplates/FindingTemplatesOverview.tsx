'use client';

import { Info } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, Card, CardBody } from '@bimstitch/ui';

import type { FindingTemplate } from '@/lib/api/schemas';

type Props = {
  templates: FindingTemplate[];
};

export function FindingTemplatesOverview({ templates }: Props): JSX.Element {
  const t = useTranslations('findingTemplates.overview');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <p className="font-sans text-body2 font-medium text-foreground">{t('introTitle')}</p>
              <p className="font-sans text-body3 text-foreground-secondary">{t('introBody')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {templates.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
