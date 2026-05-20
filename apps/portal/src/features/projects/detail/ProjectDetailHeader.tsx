'use client';

import {
  Building2, Layers, Ruler, Share2,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import type { Project } from '@/lib/api/schemas';
import { BlueprintTexture } from '@/components/BlueprintTexture';
import type { ComplianceSummary } from '@/features/compliance/types';
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

import { ProjectKpiCards } from './ProjectKpiCards';

type Props = {
  project: Project;
  compliance: ComplianceSummary | undefined;
  issueCount: number;
  dossierPct: number;
};

export function ProjectDetailHeader({
  project,
  compliance,
  issueCount,
  dossierPct,
}: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const tStatuses = useTranslations('projects.statuses');
  const tPhases = useTranslations('projects.phases');
  const [aerialFailed, setAerialFailed] = useState(false);
  const overall = compliance?.overallScore ?? 0;
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
  let opleveringSub = 'No delivery date';
  const wkbSub = compliance?.lastScanAt !== undefined && compliance.lastScanAt !== null
    ? 'From latest scan'
    : 'No scan yet';
  if (project.delivery_date !== null) {
    opleveringValue = formatDeliveryDate(project.delivery_date, locale);
    const days = daysUntil(project.delivery_date);
    opleveringSub = days >= 0
      ? `${String(days)} days remaining`
      : `${String(Math.abs(days))} days overdue`;
  }

  return (
    <div className="relative shrink-0 overflow-hidden bg-transparent px-4 pb-4 pt-[18px] text-foreground sm:px-5">
      <BlueprintTexture />

      <div className="relative z-10 grid gap-5 xl:grid-cols-[156px_minmax(0,1fr)_auto] xl:items-center">
        <div className="h-28 w-full overflow-hidden rounded-[10px] border border-black/10 bg-black/5 shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:border-white/15 dark:bg-white/10 dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)] sm:h-32 xl:h-[156px] xl:w-[156px]">
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

        {/* Project identity */}
        <div className="flex min-w-0 items-center pr-10 xl:pr-0">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
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
              {compliance?.lastScanAt !== undefined && compliance.lastScanAt !== null && (
                <>
                  <span className="text-[10.5px] text-black/40 dark:text-white/55">·</span>
                  <span className="inline-flex items-center gap-1.5 text-[10.5px] text-black/60 dark:text-white/75">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400" />
                    Last scan 26 min ago
                  </span>
                </>
              )}
            </div>
            <h1 className="truncate font-display text-[28px] font-medium leading-[1.05] tracking-[-0.022em] text-black dark:text-white sm:text-[32px]">
              {project.name}
            </h1>
            <div className="mt-1 flex flex-wrap gap-3.5 text-body3 text-black/70 dark:text-white/85">
              <span>
                <span className="text-black/40 dark:text-white/70">◉</span>{' '}
                {address ?? 'No address set'}
              </span>
              {project.contractor_name !== null && (
                <>
                  <span className="text-black/30 dark:text-white/60">·</span>
                  <span>
                    <span className="text-black/40 dark:text-white/70">⚒</span>{' '}
                    {project.contractor_name}
                  </span>
                </>
              )}
              {instrument !== undefined && (
                <>
                  <span className="text-black/30 dark:text-white/60">·</span>
                  <span title={`Toegelaten instrument · ${instrument.provider}`}>
                    <span className="text-black/40 dark:text-white/70">⚖</span>{' '}
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
            </div>
          </div>
        </div>

        {/* KPIs + share */}
        <div className="relative flex w-full items-center gap-2 pr-10 xl:max-w-none xl:pr-0">
          <ProjectKpiCards
            items={[
              { label: 'Wkb score', value: `${overall}%`, color: 'var(--success)', sub: wkbSub },
              { label: 'Issues open', value: String(issueCount), color: 'var(--error)', sub: `${compliance?.failCount ?? 0} fail · ${compliance?.warnCount ?? 0} warn` },
              { label: 'Holdback', value: '—', sub: `${dossierPct}% dossier ready` },
              { label: 'Delivery', value: opleveringValue, sub: opleveringSub },
            ]}
          />
          <button
            type="button"
            title="Share project"
            aria-label="Share project"
            className="absolute right-6 top-1/2 grid h-8 w-8 -translate-y-1/2 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-foreground-secondary transition-colors hover:bg-surface-low hover:text-primary xl:static xl:ml-3.5 xl:translate-y-0"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
