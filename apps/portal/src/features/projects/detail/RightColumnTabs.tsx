'use client';

import { useTranslations } from 'next-intl';
import { useState, type ComponentType, type JSX } from 'react';

import { Badge, Button, Eyebrow, Tabs, TabsList, TabsTrigger } from '@bimstitch/ui';
import { ClipboardCheck, FileBadge, FileText, Paperclip } from '@bimstitch/ui/icons';

import type { Model } from '@/lib/api/schemas';
import { Link } from '@/i18n/navigation';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useCertificates } from '@/features/certificates/useCertificates';
import { useFindings } from '@/features/findings/useFindings';
import { useReports } from '@/features/reports/hooks';
import { totalFromPages } from '@/lib/query/useAuthInfiniteQuery';

import { DeadlinesSection } from './DeadlinesSection';
import { DossierChecklistTab } from './DossierChecklistTab';
import { ModelsTab } from './ModelsTab';
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
  const [topTab, setTopTab] = useState('models');
  const attachmentCount = totalFromPages(useAttachments(projectId).data);
  const certificateCount = totalFromPages(useCertificates(projectId).data);
  const findingsCount = totalFromPages(useFindings(projectId).data);
  // Reports is a plain list query (not an infinite query), so read its length directly.
  const reportsCount = useReports(projectId).data?.items.length ?? 0;
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

  const topSubtitleCount = topTab === 'readiness' ? 0 : models.length;

  // The lower panel's Findings / Certificates / Attachments / Reports tabs were
  // promoted to dedicated pages; what remains here is a launcher into each of them.
  const navItems: Array<{
    key: string;
    href: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    count: number;
  }> = [
    {
      key: 'findings',
      href: `/projects/${projectId}/findings`,
      icon: ClipboardCheck,
      label: t('bevindingen.label'),
      count: findingsCount,
    },
    {
      key: 'certificates',
      href: `/projects/${projectId}/certificates`,
      icon: FileBadge,
      label: t('certificates.label'),
      count: certificateCount,
    },
    {
      key: 'attachments',
      href: `/projects/${projectId}/attachments`,
      icon: Paperclip,
      label: t('attachments.label'),
      count: attachmentCount,
    },
    {
      key: 'reports',
      href: `/projects/${projectId}/reports`,
      icon: FileText,
      label: t('rapporten.label'),
      count: reportsCount,
    },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
      {/* Top panel — launcher into the dedicated Findings / Certificates / Attachments / Reports pages */}
      <div className="shrink-0 rounded-lg border border-border bg-background p-3 shadow-sm">
        <div className="mb-2 px-0.5">
          <Eyebrow as="div" tone="tertiary">{t('nav.eyebrow')}</Eyebrow>
          <div className="text-body2 font-medium tracking-tight text-foreground">{t('nav.subtitle')}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {navItems.map(({ key, href, icon: Icon, label, count }) => (
            <Button key={key} asChild variant="primary" size="md" className="w-full justify-start">
              <Link href={href}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                <Badge variant="default" size="md" bordered={false}>{count}</Badge>
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {/* Deadlines — its own card directly below the launcher panel */}
      <div className="max-h-64 shrink-0 overflow-auto rounded-lg border border-border bg-background p-3 shadow-sm">
        <DeadlinesSection projectId={projectId} />
      </div>

      {/* Lower panel — Readiness (dossier checklist) and Models */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="shrink-0 overflow-x-auto px-3 pt-2">
          <div className="mb-2 flex min-w-max items-end justify-between gap-x-3">
            <Tabs value={topTab} onValueChange={setTopTab}>
              <TabsList className="inline-flex w-auto">
                <TabsTrigger value="models">
                  {t('models.label')}
                  <Badge variant="default" size="md" bordered={false}>
                    {models.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="readiness">{t('readiness.label')}</TabsTrigger>
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

        <div className={`min-h-0 flex-1 px-3 pb-3 pt-2 ${topTab === 'models' ? 'overflow-hidden' : 'overflow-auto'}`}>
          {/* `readiness` backs the Readiness tab: dossier checklist groups (deadlines moved to their own card above) */}
          {topTab === 'readiness' && (
            <DossierChecklistTab
              projectId={projectId}
              country={projectCountry}
              onNavigateToModels={() => { setTopTab('models'); }}
            />
          )}
          {topTab === 'models' && (
            <ModelsTab projectId={projectId} models={models} />
          )}
        </div>
      </div>
    </div>
  );
}
