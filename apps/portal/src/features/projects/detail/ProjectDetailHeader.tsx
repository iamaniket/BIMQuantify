'use client';

import { Share2 } from 'lucide-react';
import type { JSX } from 'react';

import type { Project } from '@/lib/api/schemas';
import { BlueprintTexture } from '@/components/BlueprintTexture';
import type { ComplianceSummary } from '@/features/projects/compliance/types';

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
  const overall = compliance?.overallScore ?? 0;

  return (
    <div className="relative flex shrink-0 items-center gap-6 overflow-hidden bg-primary px-6 py-5 text-white">
      <BlueprintTexture />

      {/* Project identity */}
      <div className="relative flex min-w-0 flex-1 items-center gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/15">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="#fff" strokeWidth="1.6" />
            <path d="M3 9H21M3 15H21M9 3V21M15 3V21" stroke="#fff" strokeOpacity="0.7" strokeWidth="1" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
              WKB-2026-0411
            </span>
            <span className="text-[10.5px] text-white/55">·</span>
            <span className="text-[10.5px] font-medium text-white/75">
              Uitvoering · Fase 3 / 4
            </span>
            <span className="rounded-full border border-green-400/35 bg-green-400/20 px-2 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-green-300">
              ● Active
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
              {project.description ?? 'No address set'}
            </span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="relative">
        <KpiStrip
          items={[
            { label: 'Wkb score', value: `${overall}%`, color: '#9ff0bf', sub: '↑ 4.2 wk' },
            { label: 'Issues open', value: String(issueCount), color: '#ffb3a3', sub: `${compliance?.failCount ?? 0} fail · ${compliance?.warnCount ?? 0} warn` },
            { label: 'Holdback', value: '€ 184,500', sub: `${dossierPct}% dossier ready` },
            { label: 'Oplevering', value: 'Aug 12, 2026', sub: '105 days remaining' },
          ]}
        />
      </div>

      {/* Share */}
      <button
        type="button"
        title="Share project"
        className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/20 bg-white/12 text-white transition-colors hover:bg-white/20"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
