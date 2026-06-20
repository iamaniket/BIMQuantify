'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge, Eyebrow, Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useFindings } from '@/features/findings/useFindings';
import { totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { AttachmentsTab } from './AttachmentsTab';
import { BevindingenTab } from './BevindingenTab';
import { CertificatesTab } from './CertificatesTab';
import { DeadlinesSection } from './DeadlinesSection';
import { DossierChecklistTab } from './DossierChecklistTab';
import { ModelsTab } from './ModelsTab';
import { RapportenTab } from './RapportenTab';
import { useDossierCompleteness } from './useDossierCompleteness';

type Props = {
  projectId: string;
  projectCountry: string;
  models: Model[];
};

export function RightColumnTabs({
  projectId,
  projectCountry,
  models,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const [topTab, setTopTab] = useState('readiness');
  const [bottomTab, setBottomTab] = useState('bevindingen');
  const attachmentCount = totalFromPages(useAttachments(projectId).data);
  const certificateCount = totalFromPages(useCertificates(projectId).data);
  const findingsCount = totalFromPages(useFindings(projectId).data);
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

  const topSubtitleCount = topTab === 'readiness' ? 0
    : topTab === 'rapporten' ? 0
    : models.length;

  const bottomSubtitleCount = bottomTab === 'attachments' ? attachmentCount
    : bottomTab === 'certificates' ? certificateCount
    : findingsCount;

  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
      {/* Upper panel — Overview, Dossier, Models, Reports */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 overflow-x-auto px-3 pt-2">
          <div className="mb-2 flex min-w-max items-end justify-between gap-x-3">
            <Tabs value={topTab} onValueChange={setTopTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="readiness">{t('readiness.label')}</TabsTrigger>
                <TabsTrigger value="models">
                  {t('models.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {models.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="rapporten">{t('rapporten.label')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-right">
              <Eyebrow as="div" tone="tertiary">
                {t(`${topTab}.eyebrow`)}
              </Eyebrow>
              <div className="text-body2 font-medium tracking-tight text-foreground">
                {topTab === 'readiness'
                  ? readinessSubtitle
                  : t(`${topTab}.subtitle`, { count: topSubtitleCount })}
              </div>
            </div>
          </div>
        </div>

        <div className={`min-h-0 flex-1 px-3 pb-3 pt-2 ${topTab === 'models' || topTab === 'rapporten' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {/* `readiness` backs the merged Readiness tab: dossier checklist groups + a deadlines group */}
          {topTab === 'readiness' && (
            <div className="space-y-4">
              <DossierChecklistTab projectId={projectId} country={projectCountry} />
              <DeadlinesSection projectId={projectId} />
            </div>
          )}
          {topTab === 'models' && (
            <ModelsTab projectId={projectId} models={models} />
          )}
          {topTab === 'rapporten' && <RapportenTab projectId={projectId} />}
        </div>
      </div>

      {/* Lower panel — Attachments, Findings, Certificates */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 overflow-x-auto px-3 pt-2">
          <div className="mb-2 flex min-w-max items-end justify-between gap-x-3">
            <Tabs value={bottomTab} onValueChange={setBottomTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="bevindingen">
                  {t('bevindingen.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {findingsCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="certificates">
                  {t('certificates.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {certificateCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="attachments">
                  {t('attachments.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {attachmentCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-right">
              <Eyebrow as="div" tone="tertiary">
                {t(`${bottomTab}.eyebrow`)}
              </Eyebrow>
              <div className="text-body2 font-medium tracking-tight text-foreground">
                {t(`${bottomTab}.subtitle`, { count: bottomSubtitleCount })}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
          {bottomTab === 'bevindingen' && <BevindingenTab projectId={projectId} />}
          {bottomTab === 'certificates' && <CertificatesTab projectId={projectId} />}
          {bottomTab === 'attachments' && <AttachmentsTab projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
