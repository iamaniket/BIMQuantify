'use client';

import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';

import { ModelsTab } from './ModelsTab';
import { ReportsTab } from './ReportsTab';

type Props = {
  projectId: string;
  models: Model[];
  onUpload: (modelId: string) => void;
};

export function RightColumnTabs({
  projectId,
  models,
  onUpload,
}: Props): JSX.Element {
  const [tab, setTab] = useState('models');

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="shrink-0 px-3 pt-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="models">
              Documents
              <span className="ml-1 rounded-full bg-background-secondary px-1.5 text-caption tabular-nums text-foreground-secondary">
                {models.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} onUpload={onUpload} />
        )}
        {tab === 'reports' && <ReportsTab projectId={projectId} models={models} />}
      </div>
    </div>
  );
}
