'use client';

import {
  Building2, Layers, Ruler, Share2,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import type { Project } from '@/lib/api/schemas';
import { BlueprintTexture } from '@/components/BlueprintTexture';
import type { ComplianceSummary } from '@/features/projects/compliance/types';
import {
  daysUntil,
  formatAddress,
  formatDeliveryDate,
  formatProjectBadgeLabel,
  formatStatusAndPhaseLabel,
  projectBadgeClasses,
} from '@/features/projects/projectFormatting';
import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/lib/mapThumbnail';
import { useLocale } from '@/providers/LocaleProvider';

import { KpiStrip } from './KpiStrip';

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
  const { locale, messages } = useLocale();
  const [aerialFailed, setAerialFailed] = useState(false);
  const overall = compliance?.overallScore ?? 0;
  const address = formatAddress(project);
  const refLabel = project.reference_code ?? '—';
  const statusBadgeClass = projectBadgeClasses(project);
  const stageLabel = formatStatusAndPhaseLabel(project.status, project.phase, messages);
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
  if (project.delivery_date !== null) {
    opleveringValue = formatDeliveryDate(project.delivery_date, locale);
    const days = daysUntil(project.delivery_date);
    opleveringSub = days >= 0
      ? `${String(days)} days remaining`
      : `${String(Math.abs(days))} days overdue`;
  }

  return (
    <div className="relative flex min-h-[11.5rem] shrink-0 flex-col gap-5 overflow-hidden bg-primary px-6 py-6 text-white xl:flex-row xl:items-center xl:gap-6">
      <BlueprintTexture />

      <div className="relative z-10 h-32 w-full overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.22)] xl:h-36 xl:w-60 xl:shrink-0">
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
          <div className="flex h-full items-center justify-center gap-3 bg-gradient-to-br from-white/12 via-white/6 to-black/10">
            <Building2 className="h-10 w-10 text-white/70" />
            <Layers className="h-7 w-7 text-white/40" />
            <Ruler className="h-6 w-6 text-white/40" />
          </div>
        )}
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        {/* Project identity */}
        <div className="flex min-w-0 flex-1 items-center pr-12 xl:pr-0">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
                {refLabel}
              </span>
              <span className="text-[10.5px] text-white/55">·</span>
              <span className="text-[10.5px] font-medium text-white/75">
                {stageLabel}
              </span>
              <span
                className={`rounded-full border px-2 py-px text-[10px] font-bold uppercase tracking-[0.04em] ${statusBadgeClass}`}
              >
                ● {formatProjectBadgeLabel(project, messages)}
              </span>
              {compliance?.lastScanAt !== undefined && compliance.lastScanAt !== null && (
                <>
                  <span className="text-[10.5px] text-white/55">·</span>
                  <span className="inline-flex items-center gap-1.5 text-[10.5px] text-white/75">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    Last scan 26 min ago
                  </span>
                </>
              )}
            </div>
            <h1 className="text-[30px] font-medium leading-tight tracking-tight text-white">
              {project.name}
            </h1>
            <div className="mt-1 flex flex-wrap gap-3.5 text-body3 text-white/70">
              <span>
                <span className="text-white/45">◉</span>{' '}
                {address ?? 'No address set'}
              </span>
              {project.contractor_name !== null && (
                <>
                  <span className="text-white/35">·</span>
                  <span>
                    <span className="text-white/45">⚒</span>{' '}
                    {project.contractor_name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="relative xl:shrink-0">
          <KpiStrip
            items={[
              { label: 'Wkb score', value: `${overall}%`, color: '#9ff0bf', sub: '↑ 4.2 wk' },
              { label: 'Issues open', value: String(issueCount), color: '#ffb3a3', sub: `${compliance?.failCount ?? 0} fail · ${compliance?.warnCount ?? 0} warn` },
              { label: 'Holdback', value: '€ 184,500', sub: `${dossierPct}% dossier ready` },
              { label: 'Delivery', value: opleveringValue, sub: opleveringSub },
            ]}
          />
        </div>
      </div>

      {/* Share */}
      <button
        type="button"
        title="Share project"
        className="absolute right-6 top-6 z-20 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/20 bg-white/12 text-white transition-colors hover:bg-white/20"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
