'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';

import { BevindingenTab } from './BevindingenTab';
import { BorgingsplanTab } from './BorgingsplanTab';
import { DocumentenTab } from './DocumentenTab';
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
      <div className="shrink-0 px-3 pt-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="models">
              {t('models.label')}
              <span className="ml-1 rounded-full bg-background-secondary px-1.5 text-caption tabular-nums text-foreground-secondary">
                {models.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="borgingsplan">{t('borgingsplan.label')}</TabsTrigger>
            <TabsTrigger value="inspecties">{t('inspecties.label')}</TabsTrigger>
            <TabsTrigger value="bevindingen">{t('bevindingen.label')}</TabsTrigger>
            <TabsTrigger value="documenten">{t('documenten.label')}</TabsTrigger>
            <TabsTrigger value="rapporten">{t('rapporten.label')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} onUpload={onUpload} />
        )}
        {tab === 'borgingsplan' && (
          <BorgingsplanTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'inspecties' && <InspectiesTab />}
        {tab === 'bevindingen' && <BevindingenTab />}
        {tab === 'documenten' && <DocumentenTab />}
        {tab === 'rapporten' && <ReportsTab projectId={projectId} models={models} />}
      </div>
    </div>
  );
}
