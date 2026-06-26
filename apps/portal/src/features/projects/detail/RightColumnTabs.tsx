'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge, Eyebrow, Tabs, TabsList, TabsTrigger } from '@bimdossier/ui';

import type { Document } from '@/lib/api/schemas';

import { DeadlinesSection } from './DeadlinesSection';
import { DossierChecklistTab } from './DossierChecklistTab';
import { DocumentsTab } from './DocumentsTab';
import { QualityLauncherGrid } from './launcher/QualityLauncherGrid';
import { useDeadlines } from './deadlines/useDeadlines';
import { useDossierCompleteness } from './useDossierCompleteness';

type Props = {
  projectId: string;
  projectCountry: string;
  documents: Document[];
};

export function RightColumnTabs({
  projectId,
  projectCountry,
  documents,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const [topTab, setTopTab] = useState('documents');
  // React Query dedupes — the page and DeadlinesSection already fetch this, so
  // reading the count here for the tab badge is free.
  const deadlinesCount = useDeadlines(projectId).data?.length ?? 0;
  const dossier = useDossierCompleteness(projectId, projectCountry);

  // Readiness header doubles as the dossier-completeness headline now that the
  // in-tab progress bar is gone; the percentage is only meaningful once loaded
  // and a template exists, so fall back to the descriptive subtitle otherwise.
  const readinessSubtitle =
    dossier.isLoading || dossier.templateEmpty
      ? t('readiness.subtitle')
      : t('readiness.progress', {
          pct: dossier.pct,
          filled: dossier.filled,
          total: dossier.total,
        });

  // Right-side header subtitle for the lower panel, keyed off the active tab.
  const lowerSubtitle =
    topTab === 'readiness'
      ? readinessSubtitle
      : topTab === 'deadlines'
        ? t('deadlines.headerSubtitle', { count: deadlinesCount })
        : t('documents.subtitle', { count: documents.length });

  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
      {/* Upper panel — Quality & Documents launcher (Findings / Certificates /
          Attachments / Reports). No card chrome of its own: each of the four
          entity cards carries its own border, so they sit directly in the column
          (no nested card-in-card) and use the full width. Deadlines moved to the
          lower panel's tabs. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <QualityLauncherGrid projectId={projectId} />
      </div>

      {/* Lower panel — Documents, Readiness (dossier checklist) and Deadlines */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 overflow-x-auto px-3 pt-2">
          <div className="mb-2 flex min-w-max items-end justify-between gap-x-3">
            <Tabs value={topTab} onValueChange={setTopTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="documents">
                  {t('documents.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {documents.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="readiness">{t('readiness.label')}</TabsTrigger>
                <TabsTrigger value="deadlines">
                  {t('deadlines.label')}
                  <Badge variant="default" size="md" bordered={false}>{deadlinesCount}</Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-right">
              <Eyebrow as="div" tone="tertiary">
                {t(`${topTab}.eyebrow`)}
              </Eyebrow>
              <div className="text-body2 font-medium tracking-tight text-foreground">
                {lowerSubtitle}
              </div>
            </div>
          </div>
        </div>

        <div className={`min-h-0 flex-1 px-3 pb-3 pt-2 ${topTab === 'documents' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {/* `readiness` backs the Readiness tab: dossier checklist groups */}
          {topTab === 'readiness' && (
            <DossierChecklistTab
              projectId={projectId}
              country={projectCountry}
              onNavigateToModels={() => { setTopTab('documents'); }}
            />
          )}
          {topTab === 'documents' && (
            <DocumentsTab projectId={projectId} documents={documents} />
          )}
          {topTab === 'deadlines' && <DeadlinesSection projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
