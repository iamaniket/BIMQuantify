'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useFindings } from '@/features/findings/useFindings';

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
  const [tab, setTab] = useState('overzicht');
  const attachmentCount = useAttachments(projectId).data?.length ?? 0;
  const certificateCount = useCertificates(projectId).data?.length ?? 0;
  const findingsCount = useFindings(projectId).data?.length ?? 0;

  const subtitleCount = tab === 'attachments' ? attachmentCount
    : tab === 'certificates' ? certificateCount
    : tab === 'bevindingen' ? findingsCount
    : tab === 'dossier' ? 0
    : tab === 'rapporten' ? 0
    : models.length;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="shrink-0 p-4 pb-0">
        <div className="mb-3 flex items-end justify-between">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="inline-flex w-auto">
              <TabsTrigger value="overzicht">{t('overzicht.label')}</TabsTrigger>
              <TabsTrigger value="dossier">{t('dossier.label')}</TabsTrigger>
              <TabsTrigger value="models">
                {t('models.label')}
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-background-secondary text-caption tabular-nums text-foreground-secondary">
                  {models.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="attachments">
                {t('attachments.label')}
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-background-secondary text-caption tabular-nums text-foreground-secondary">
                  {attachmentCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="bevindingen">
                {t('bevindingen.label')}
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-background-secondary text-caption tabular-nums text-foreground-secondary">
                  {findingsCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="certificates">
                {t('certificates.label')}
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-background-secondary text-caption tabular-nums text-foreground-secondary">
                  {certificateCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="rapporten">{t('rapporten.label')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
              {t(`${tab}.eyebrow`)}
            </div>
            <div className="mt-0.5 text-title3 font-medium tracking-tight text-foreground">
              {t(`${tab}.subtitle`, { count: subtitleCount })}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'overzicht' && (
          <OverzichtTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'dossier' && (
          <DossierChecklistTab projectId={projectId} country={projectCountry} />
        )}
        {tab === 'attachments' && <AttachmentsTab projectId={projectId} />}
        {tab === 'certificates' && <CertificatesTab projectId={projectId} />}
        {tab === 'bevindingen' && <BevindingenTab projectId={projectId} />}
        {tab === 'models' && (
          <ModelsTab projectId={projectId} models={models} />
        )}
        {tab === 'rapporten' && <RapportenTab projectId={projectId} />}
      </div>
    </div>
  );
}
