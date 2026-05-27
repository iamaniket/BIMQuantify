'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';

import { BevindingenTab } from './BevindingenTab';
import { BorgingsplanTab } from './BorgingsplanTab';
import { DeadlinesTab } from './DeadlinesTab';
import { AttachmentsTab } from './AttachmentsTab';
import { InspectiesTab } from './InspectiesTab';
import { ModelsTab } from './ModelsTab';
import { ReportsTab } from './ReportsTab';

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
  const [tab, setTab] = useState('models');

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
              <TabsTrigger value="models">
                {t('models.label')}
                <span className="ml-1 rounded-full bg-background-secondary px-1.5 text-caption tabular-nums text-foreground-secondary">
                  {models.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="borgingsplan">{t('borgingsplan.label')}</TabsTrigger>
              <TabsTrigger value="deadlines">{t('deadlines.label')}</TabsTrigger>
              <TabsTrigger value="inspecties">{t('inspecties.label')}</TabsTrigger>
              <TabsTrigger value="bevindingen">{t('bevindingen.label')}</TabsTrigger>
              <TabsTrigger value="attachments">{t('attachments.label')}</TabsTrigger>
              <TabsTrigger value="rapporten">{t('rapporten.label')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} onUpload={onUpload} />
        )}
        {tab === 'borgingsplan' && (
          <BorgingsplanTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'deadlines' && (
          <DeadlinesTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'inspecties' && <InspectiesTab />}
        {tab === 'bevindingen' && <BevindingenTab />}
        {tab === 'attachments' && <AttachmentsTab projectId={projectId} />}
        {tab === 'rapporten' && <ReportsTab projectId={projectId} models={models} />}
      </div>
    </div>
  );
}
