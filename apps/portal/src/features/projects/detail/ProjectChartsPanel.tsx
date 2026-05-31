'use client';

import { useTranslations } from 'next-intl';
import { type JSX, type ReactNode, useMemo } from 'react';

import { ActivityTimeline } from '@/components/shared/charts/ActivityTimeline';
import { DossierDonut } from '@/components/shared/charts/DossierDonut';

import type { JurisdictionDossierRequirement } from '@/lib/api/jurisdictions';
import type { Attachment } from '@/lib/api/schemas/attachments';
import type { Certificate } from '@/lib/api/schemas/certificates';
import type { Deadline } from '@/lib/api/schemas/deadlines';
import type { ProjectActivityEntry } from '@/lib/api/schemas/activity';

import { buildCompletionSeries, type DossierCompleteness } from './dossierTemplate';

type Props = {
  dossier: DossierCompleteness;
  template: JurisdictionDossierRequirement[];
  deadlines: Deadline[];
  attachments: Attachment[];
  certificates: Certificate[];
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
    <div className="flex h-full min-h-0 flex-col items-center gap-2 px-1 py-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
        {title}
      </span>
      <div className="flex w-full min-h-0 flex-1 items-center justify-center overflow-auto">
        {children}
      </div>
    </div>
  );
}

export function ProjectChartsPanel({
  dossier,
  template,
  deadlines,
  attachments,
  certificates,
  activityEntries,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.chartsPanel');

  const completion = useMemo(
    () => buildCompletionSeries(template, attachments, certificates),
    [template, attachments, certificates],
  );

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
        {/* Dossier completeness donut — ~80% of the panel height */}
        <div className="min-h-0 flex-[4]">
          <PanelSection title={t('dossierTitle')}>
            <DossierDonut pct={dossier.pct} requirements={dossier.requirements} />
          </PanelSection>
        </div>

        {/* Activity timeline — ~20% of the panel height */}
        <div className="flex-1 border-t border-border pt-1">
          <PanelSection title={t('timelineTitle')}>
            <ActivityTimeline
              completion={completion}
              activityEntries={activityEntries}
              deadlines={deadlines}
            />
          </PanelSection>
        </div>
      </div>
    </div>
  );
}
