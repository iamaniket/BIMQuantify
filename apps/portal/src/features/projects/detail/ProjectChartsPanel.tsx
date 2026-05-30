'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type JSX, type ReactNode } from 'react';

import { ActivityTimeline } from '@/components/shared/charts/ActivityTimeline';
import { DossierDonut } from '@/components/shared/charts/DossierDonut';

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

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col items-center gap-2 px-1 py-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
        {title}
      </span>
      <div className="flex w-full flex-1 items-center justify-center overflow-auto">
        {children}
      </div>
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

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        {/* Dossier completeness donut — ~80% of the panel height */}
        <div className="flex-[4]">
          <PanelSection title={t('dossierTitle')}>
            <DossierDonut pct={dossier.pct} categories={dossier.categories} />
          </PanelSection>
        </div>

        {/* Activity timeline — ~20% of the panel height */}
        <div className="flex-1 border-t border-border pt-1">
          <PanelSection title={t('timelineTitle')}>
            <ActivityTimeline
              attachments={attachments}
              buildingType={buildingType}
              activityEntries={activityEntries}
              deadlines={deadlines}
            />
          </PanelSection>
        </div>
      </div>
    </div>
  );
}
