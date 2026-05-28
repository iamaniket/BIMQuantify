'use client';

import {
  FileAudio, FileText, FileVideo, Image, Package,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { ComplianceDonut } from '@/components/shared/charts/ComplianceDonut';
import { DossierGauge } from '@/components/shared/charts/DossierGauge';
import { TrendSparkline } from '@/components/shared/charts/TrendSparkline';

import type { Attachment } from '@/lib/api/schemas/attachments';
import type { Deadline } from '@/lib/api/schemas/deadlines';
import type { BuildingTypeValue } from '@/lib/api/schemas/projects';
import type { ProjectActivityEntry } from '@/lib/api/schemas/activity';

import { computeDossierCompleteness } from './dossierTemplate';

type Props = {
  buildingType: BuildingTypeValue | null;
  deadlines: Deadline[];
  attachments: Attachment[];
  activityEntries: ProjectActivityEntry[];
};

const CATEGORY_ICONS: Record<string, typeof Image> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: Package,
};

function bucketActivityByDay(entries: ProjectActivityEntry[], days: number): number[] {
  const now = Date.now();
  const buckets = new Array<number>(days).fill(0);
  for (const e of entries) {
    const age = now - new Date(e.created_at).getTime();
    const dayIndex = days - 1 - Math.floor(age / 86_400_000);
    if (dayIndex >= 0 && dayIndex < days) {
      buckets[dayIndex] = (buckets[dayIndex] ?? 0) + 1;
    }
  }
  return buckets;
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col items-center gap-2 rounded-lg border border-border bg-surface-low p-3 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
        {title}
      </span>
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </div>
  );
}

export function ProjectChartsPanel({
  buildingType,
  deadlines,
  attachments,
  activityEntries,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');

  const dossier = useMemo(
    () => computeDossierCompleteness(buildingType, attachments),
    [buildingType, attachments],
  );

  const deadlineSummary = useMemo(() => {
    let met = 0;
    let pending = 0;
    let overdue = 0;
    for (const d of deadlines) {
      if (d.status === 'met') met++;
      else if (d.is_overdue) overdue++;
      else if (d.status === 'pending') pending++;
    }
    return { met, pending, overdue, total: deadlines.length };
  }, [deadlines]);

  const docCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of attachments) {
      if (a.status === 'ready') {
        counts.set(a.attachment_category, (counts.get(a.attachment_category) ?? 0) + 1);
      }
    }
    return counts;
  }, [attachments]);

  const activityData = useMemo(
    () => bucketActivityByDay(activityEntries, 14),
    [activityEntries],
  );

  const donutSegments = [
    { value: deadlineSummary.met, color: 'var(--success)' },
    { value: deadlineSummary.pending, color: 'var(--primary)' },
    { value: deadlineSummary.overdue, color: 'var(--error)' },
  ];

  const categoryKeys = ['image', 'office', 'video', 'audio', 'other'] as const;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2.5 overflow-auto p-3">
        {/* Dossier completeness gauge */}
        <ChartCard title={t('dossierTitle')}>
          <DossierGauge value={dossier.pct} label={t('dossierTitle')} size={130} />
        </ChartCard>

        {/* Deadline status donut */}
        <ChartCard title={t('deadlinesTitle')}>
          {deadlineSummary.total === 0 ? (
            <span className="text-caption text-foreground-tertiary">{t('noData')}</span>
          ) : (
            <ComplianceDonut
              segments={donutSegments}
              centerValue={String(deadlineSummary.total)}
              centerLabel={t('deadlinesTitle')}
              size={130}
            />
          )}
        </ChartCard>

        {/* Documents by category */}
        <ChartCard title={t('documentsTitle')}>
          <div className="flex w-full flex-col gap-1.5 px-1">
            {categoryKeys.map((cat) => {
              const count = docCounts.get(cat) ?? 0;
              const Icon: typeof Image = CATEGORY_ICONS[cat] ?? Package;
              return (
                <div key={cat} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
                  <span className="min-w-0 flex-1 text-[11px] capitalize text-foreground-secondary">
                    {cat}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-foreground">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </ChartCard>

        {/* Activity sparkline */}
        <ChartCard title={t('activityTitle')}>
          <TrendSparkline data={activityData} width={140} height={50} />
        </ChartCard>
      </div>
    </div>
  );
}
