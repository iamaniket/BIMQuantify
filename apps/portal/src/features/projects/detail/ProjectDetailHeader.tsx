'use client';

import { Building2, Layers, MapPin, Ruler } from '@bimdossier/ui/icons';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import type { Project } from '@/lib/api/schemas';
import {
  daysUntil,
  formatAddress,
  formatDeliveryDate,
  formatProjectBadgeLabel,
  projectBadgeClasses,
} from '@/lib/formatting/projects';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimdossier/i18n';

import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/features/jurisdictions/nl/mapThumbnail';
import { HeroShell } from '@/components/shared/layout/HeroShell';

type DeadlinesSummary = {
  met: number;
  total: number;
  overdue: number;
};

type Props = {
  project: Project;
  deadlinesSummary?: DeadlinesSummary;
  attachmentCount?: number;
  dossierPct?: number;
  action?: ReactNode;
  /** Free tier: deadlines / attachments / dossier-holdback are paid-only, so the
   * header shows just the delivery-date KPI. */
  isFree?: boolean;
};

export function ProjectDetailHeader({
  project,
  deadlinesSummary,
  attachmentCount,
  dossierPct,
  action,
  isFree = false,
}: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const tPhases = useTranslations('projects.phases');
  const tHero = useTranslations('projectDetail.hero');
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [aerialFailed, setAerialFailed] = useState(false);
  // Clear the failed flags when the source changes, otherwise one <img> error
  // (e.g. an expired presigned URL after S3_PRESIGN_TTL_SECONDS) pins the map
  // fallback forever — even after a refetch delivers a fresh, loadable URL.
  useEffect(() => { setThumbnailFailed(false); }, [project.thumbnail_url]);
  useEffect(() => { setAerialFailed(false); }, [project.latitude, project.longitude]);
  const address = formatAddress(project);
  const refLabel = project.reference_code ?? '—';
  const statusBadgeClass = projectBadgeClasses(project);
  const stageLabel = tPhases(project.phase);
  const showThumbnail = project.thumbnail_url !== null && !thumbnailFailed;
  const aerialUrl = (
    !showThumbnail
    && project.latitude !== null
    && project.longitude !== null
    && isWithinNetherlands(project.latitude, project.longitude)
    && !aerialFailed
  )
    ? pdokAerialThumbnailUrl(project.latitude, project.longitude, { width: 720, height: 432 })
    : null;

  let opleveringValue = '—';
  let opleveringSub = tHero('noDeliveryDate');
  if (project.delivery_date !== null) {
    opleveringValue = formatDeliveryDate(project.delivery_date, locale);
    const days = daysUntil(project.delivery_date);
    opleveringSub = days >= 0
      ? tHero('daysRemaining', { count: days })
      : tHero('daysOverdue', { count: Math.abs(days) });
  }

  const thumbnail = (
    <div className="h-[112px] w-[160px] overflow-hidden rounded-[10px] bg-black/5 shadow-hero-thumbnail dark:bg-white/10">
      {showThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.thumbnail_url!}
          alt={tHero('thumbnailAlt', { name: project.name })}
          className="h-full w-full object-cover"
          onError={() => setThumbnailFailed(true)}
        />
      ) : aerialUrl !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={aerialUrl}
          alt={tHero('mapPreviewAlt', { name: project.name })}
          className="h-full w-full object-cover"
          onError={() => setAerialFailed(true)}
        />
      ) : (
        <div className="flex h-full items-center justify-center gap-3 bg-gradient-to-br from-black/5 via-black/2 to-black/10 dark:from-white/12 dark:via-white/6 dark:to-black/10">
          <Building2 className="h-10 w-10 text-black/40 dark:text-white/70" />
          <Layers className="h-7 w-7 text-black/20 dark:text-white/40" />
          <Ruler className="h-6 w-6 text-black/20 dark:text-white/40" />
        </div>
      )}
    </div>
  );

  const badgeRow = (
    <>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-black dark:text-white">
        {refLabel}
      </span>
      <span className="text-[10.5px] text-black/40 dark:text-white/55">·</span>
      <span className="text-[10.5px] font-medium text-black/80 dark:text-white/90">
        {stageLabel}
      </span>
      <span
        className={`rounded-full border border-black/15 px-2 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-black dark:border-white/20 dark:text-white ${statusBadgeClass}`}
      >
        {'●'} {formatProjectBadgeLabel(project, tPhases(project.phase))}
      </span>
    </>
  );

  const subtitleRow = (
    <>
      <span className="inline-flex items-center gap-1">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
        {address ?? tHero('noAddress')}
      </span>
    </>
  );

  return (
    <HeroShell
      image={thumbnail}
      title={project.name}
      description={project.description}
      badge={badgeRow}
      subtitle={subtitleRow}
      kpis={[
        // Deadlines / attachments / holdback are org-only — dropped for free.
        ...(isFree
          ? []
          : [
              {
                label: tHero('deadlines'),
                value: deadlinesSummary !== undefined && deadlinesSummary.total > 0
                  ? `${String(deadlinesSummary.met)}/${String(deadlinesSummary.total)}`
                  : tHero('noDeadlines'),
                sub: deadlinesSummary !== undefined && deadlinesSummary.total > 0
                  ? tHero('deadlinesMetCount', { met: deadlinesSummary.met, total: deadlinesSummary.total })
                  : tHero('noDeadlines'),
                ...(deadlinesSummary !== undefined && deadlinesSummary.overdue > 0
                  ? { color: 'var(--error)' }
                  : {}),
              },
              {
                label: tHero('attachments'),
                value: attachmentCount !== undefined && attachmentCount > 0
                  ? String(attachmentCount)
                  : '—',
                sub: attachmentCount !== undefined && attachmentCount > 0
                  ? tHero('attachmentsCount', { count: attachmentCount })
                  : tHero('noAttachments'),
              },
              {
                label: tHero('holdback'),
                value: dossierPct !== undefined ? `${String(dossierPct)}%` : '—',
                sub: tHero('dossierReady', { pct: dossierPct ?? 0 }),
                ...(dossierPct !== undefined && dossierPct >= 85
                  ? { color: 'var(--success)' }
                  : dossierPct !== undefined && dossierPct >= 70
                    ? { color: 'var(--warning)' }
                    : {}),
              },
            ]),
        { label: tHero('delivery'), value: opleveringValue, sub: opleveringSub },
      ]}
      action={action}
    />
  );
}
