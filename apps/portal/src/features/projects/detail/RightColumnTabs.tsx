'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Badge, Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import { Eyebrow } from '@/components/shared/Eyebrow';
import type { Model } from '@/lib/api/schemas';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useFindings } from '@/features/findings/useFindings';
import { totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { AttachmentsTab } from './AttachmentsTab';
import { BevindingenTab } from './BevindingenTab';
import { CertificatesTab } from './CertificatesTab';
import { DossierChecklistTab } from './DossierChecklistTab';
import { ModelsTab } from './ModelsTab';
import { OverzichtTab } from './OverzichtTab';
import { RapportenTab } from './RapportenTab';

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
  const [topTab, setTopTab] = useState('overzicht');
  const [bottomTab, setBottomTab] = useState('attachments');
  const attachmentCount = totalFromPages(useAttachments(projectId).data);
  const certificateCount = totalFromPages(useCertificates(projectId).data);
  const findingsCount = totalFromPages(useFindings(projectId).data);

  const topSubtitleCount = topTab === 'dossier' ? 0
    : topTab === 'rapporten' ? 0
    : models.length;

  const bottomSubtitleCount = bottomTab === 'attachments' ? attachmentCount
    : bottomTab === 'certificates' ? certificateCount
    : findingsCount;

  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
      {/* Upper panel — Overview, Dossier, Models, Reports */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 p-4 pb-0">
          <div className="mb-3 flex items-end justify-between">
            <Tabs value={topTab} onValueChange={setTopTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="overzicht">{t('overzicht.label')}</TabsTrigger>
                <TabsTrigger value="dossier">{t('dossier.label')}</TabsTrigger>
                <TabsTrigger value="models">
                  {t('models.label')}
                  <Badge variant="default" size="sm" bordered={false}>
                    {models.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="rapporten">{t('rapporten.label')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-right">
              <Eyebrow>
                {t(`${topTab}.eyebrow`)}
              </Eyebrow>
              <div className="mt-0.5 text-title3 font-medium tracking-tight text-foreground">
                {t(`${topTab}.subtitle`, { count: topSubtitleCount })}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {topTab === 'overzicht' && (
            <OverzichtTab projectId={projectId} country={projectCountry} />
          )}
          {topTab === 'dossier' && (
            <DossierChecklistTab projectId={projectId} country={projectCountry} />
          )}
          {topTab === 'models' && (
            <ModelsTab projectId={projectId} models={models} />
          )}
          {topTab === 'rapporten' && <RapportenTab projectId={projectId} />}
        </div>
      </div>

      {/* Lower panel — Attachments, Findings, Certificates */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 p-4 pb-0">
          <div className="mb-3 flex items-end justify-between">
            <Tabs value={bottomTab} onValueChange={setBottomTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="attachments">
                  {t('attachments.label')}
                  <Badge variant="default" size="sm" bordered={false}>
                    {attachmentCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="bevindingen">
                  {t('bevindingen.label')}
                  <Badge variant="default" size="sm" bordered={false}>
                    {findingsCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="certificates">
                  {t('certificates.label')}
                  <Badge variant="default" size="sm" bordered={false}>
                    {certificateCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-right">
              <Eyebrow>
                {t(`${bottomTab}.eyebrow`)}
              </Eyebrow>
              <div className="mt-0.5 text-title3 font-medium tracking-tight text-foreground">
                {t(`${bottomTab}.subtitle`, { count: bottomSubtitleCount })}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {bottomTab === 'attachments' && <AttachmentsTab projectId={projectId} />}
          {bottomTab === 'bevindingen' && <BevindingenTab projectId={projectId} />}
          {bottomTab === 'certificates' && <CertificatesTab projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
