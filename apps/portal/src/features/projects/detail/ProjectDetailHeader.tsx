'use client';

import {
  Building2, Hammer, Layers, MapPin, Ruler, Scale, Share2,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import type { Project } from '@/lib/api/schemas';
import { Link } from '@/i18n/navigation';
import {
  daysUntil,
  formatAddress,
  formatDeliveryDate,
  formatProjectBadgeLabel,
  projectBadgeClasses,
} from '@/lib/formatting/projects';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';

import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/features/jurisdictions/nl/mapThumbnail';
import { INSTRUMENT_OPTIONS } from '@/features/projects/wizard/projectWizardSteps';
import { HeroShell } from '@/components/shared/layout/HeroShell';

type DeadlinesSummary = {
  met: number;
  total: number;
  overdue: number;
};

type Props = {
  project: Project;
  deadlinesSummary?: DeadlinesSummary;
  documentCount?: number;
  dossierPct?: number;
};

export function ProjectDetailHeader({
  project,
  deadlinesSummary,
  documentCount,
  dossierPct,
}: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const tStatuses = useTranslations('projects.statuses');
  const tPhases = useTranslations('projects.phases');
  const tHero = useTranslations('projectDetail.hero');
  const [aerialFailed, setAerialFailed] = useState(false);
  const address = formatAddress(project);
  const refLabel = project.reference_code ?? '—';
  const statusBadgeClass = projectBadgeClasses(project);
  const stageLabel = `${tStatuses(project.status)} · ${tPhases(project.phase)}`;
  const instrument = project.instrument_id === null
    ? undefined
    : INSTRUMENT_OPTIONS.find((opt) => opt.value === project.instrument_id);
  const aerialUrl = (
    project.thumbnail_url === null
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
    <div className="h-28 w-full overflow-hidden rounded-[10px] border border-black/10 bg-black/5 shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:border-white/15 dark:bg-white/10 dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)] sm:h-32 xl:h-[130px] xl:w-[195px]">
      {project.thumbnail_url !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.thumbnail_url}
          alt={`${project.name} thumbnail`}
          className="h-full w-full object-cover"
        />
      ) : aerialUrl !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={aerialUrl}
          alt={`${project.name} map preview`}
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
        ● {formatProjectBadgeLabel(project, tStatuses(project.status))}
      </span>
    </>
  );

  const subtitleRow = (
    <>
      <span className="inline-flex items-center gap-1">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
        {address ?? 'No address set'}
      </span>
      {project.contractor_name !== null && (
        <>
          <span className="text-black/30 dark:text-white/60">·</span>
          <span className="inline-flex items-center gap-1">
            <Hammer className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
            {project.contractor_name}
          </span>
        </>
      )}
      {instrument !== undefined && (
        <>
          <span className="text-black/30 dark:text-white/60">·</span>
          <span className="inline-flex items-center gap-1" title={`Toegelaten instrument · ${instrument.provider}`}>
            <Scale className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
            <a
              href={instrument.methodology_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-2 hover:underline"
            >
              {instrument.label}
            </a>
          </span>
        </>
      )}
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
          label: tHero('documents'),
          value: documentCount !== undefined && documentCount > 0
            ? String(documentCount)
            : '—',
          sub: documentCount !== undefined && documentCount > 0
            ? tHero('documentsCount', { count: documentCount })
            : tHero('noDocuments'),
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
        { label: tHero('delivery'), value: opleveringValue, sub: opleveringSub },
      ]}
      action={
        <Link
          href={`/projects/${project.id}/access`}
          title="Share project"
          aria-label="Share project"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-foreground-secondary transition-colors hover:bg-surface-low hover:text-primary"
        >
          <Share2 className="h-3.5 w-3.5" />
        </Link>
      }
    />
  );
}
