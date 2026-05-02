'use client';

import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';
import type {
  ComplianceIssue,
  ActivityItem,
  DossierData,
} from '@/features/projects/compliance/types';

import { ModelsTab } from './ModelsTab';
import { IssuesTab } from './IssuesTab';
import { ActivityTab } from './ActivityTab';
import { DossierTab } from './DossierTab';
import { ReportsTab } from './ReportsTab';

type Props = {
  projectId: string;
  models: Model[];
  issues: ComplianceIssue[];
  activity: ActivityItem[];
  dossier: DossierData | undefined;
  onUpload: (modelId: string) => void;
};

export function RightColumnTabs({
  projectId,
  models,
  issues,
  activity,
  dossier,
  onUpload,
}: Props): JSX.Element {
  const [tab, setTab] = useState('models');

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="shrink-0 px-4 pt-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="models">
              Models
              <span className="ml-1 rounded-full bg-background-secondary px-1.5 text-caption tabular-nums">
                {models.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="issues">
              Issues
              <span className="ml-1 rounded-full bg-error-lighter px-1.5 text-caption tabular-nums text-error">
                {issues.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="dossier">Dossier</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} onUpload={onUpload} />
        )}
        {tab === 'issues' && <IssuesTab issues={issues} />}
        {tab === 'reports' && <ReportsTab projectId={projectId} models={models} />}
        {tab === 'activity' && (
          <div>
            <ActivityTab activity={activity} />
          </div>
        )}
        {tab === 'dossier' && dossier !== undefined && (
          <div>
            <DossierTab dossier={dossier} />
          </div>
        )}
      </div>
    </div>
  );
}
