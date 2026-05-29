'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';

import { AttachmentsTab } from './AttachmentsTab';
import { BevindingenTab } from './BevindingenTab';
import { ModelsTab } from './ModelsTab';
import { OverzichtTab } from './OverzichtTab';

type Props = {
  projectId: string;
  projectCountry: string;
  models: Model[];
  onUpload: (modelId: string) => void;
};

export function RightColumnTabs({
  projectId,
  projectCountry,
  models,
  onUpload,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const [tab, setTab] = useState('overzicht');

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="shrink-0 p-4 pb-0">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
              {t('eyebrow')}
            </div>
            <div className="mt-0.5 text-title3 font-medium tracking-tight text-foreground">
              {t('subtitle', { count: models.length })}
            </div>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="inline-flex w-auto">
              <TabsTrigger value="overzicht">{t('overzicht.label')}</TabsTrigger>
              <TabsTrigger value="documenten">{t('documenten.label')}</TabsTrigger>
              <TabsTrigger value="bevindingen">{t('bevindingen.label')}</TabsTrigger>
              <TabsTrigger value="models">
                {t('models.label')}
                <span className="ml-1 rounded-full bg-background-secondary px-1.5 text-caption tabular-nums text-foreground-secondary">
                  {models.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'overzicht' && (
          <OverzichtTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'documenten' && <AttachmentsTab projectId={projectId} />}
        {tab === 'bevindingen' && <BevindingenTab projectId={projectId} />}
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} onUpload={onUpload} />
        )}
      </div>
    </div>
  );
}
