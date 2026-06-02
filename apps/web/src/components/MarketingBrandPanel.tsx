'use client';

import {
  BrandMark,
  HeroGrid,
  KpiStrip,
  LegalFooter,
} from '@bimstitch/brand';
import { NetherlandsMap, type MapMarker } from '@bimstitch/map';
import { useEffect, useState, type JSX } from 'react';

import { fetchProjectsMap, fetchSystemStatus } from '@/lib/api';
import { formatApproxCount } from '@/lib/formatting/numbers';

type StatusState = {
  status: 'normal' | 'degraded' | 'down' | 'loading';
  wkb: string;
  bbl: string;
  ifc: string;
};

const STATUS_DEFAULTS: StatusState = {
  status: 'loading',
  wkb: '2026.1',
  bbl: 'v2026.04',
  ifc: '4.3',
};

const LEGAL_LINKS = [
  { href: '/legal/privacy', label: 'Privacy policy' },
  { href: '/legal/terms', label: 'Terms of service' },
  { href: '/legal/dpa', label: 'Data processing agreement (DPA)' },
] as const;

export function MarketingBrandPanel(): JSX.Element {
  const [markers, setMarkers] = useState<readonly MapMarker[]>([]);
  const [sysStatus, setSysStatus] = useState<StatusState>(STATUS_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    fetchProjectsMap()
      .then((points) => {
        if (cancelled) return;
        setMarkers(points.map((p): MapMarker => ({
          lat: p.lat,
          lng: p.lng,
          label: p.city,
          count: p.count,
        })));
      })
      .catch(() => {
        // Marketing page tolerates a missing API — just render an empty map.
      });
    fetchSystemStatus()
      .then((live) => {
        if (cancelled) return;
        setSysStatus({
          status: live.status,
          wkb: live.wkb_version,
          bbl: live.bbl_version,
          ifc: live.ifc_version,
        });
      })
      .catch(() => {
        // Fall back to defaults when the API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalProjects = markers.reduce((sum, m) => sum + (m.count ?? 1), 0);

  const statusLabel = sysStatus.status === 'normal' ? 'Normal'
    : sysStatus.status === 'degraded' ? 'Degraded'
      : sysStatus.status === 'down' ? 'Outage'
        : '—';

  return (
    <>
      <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

      <div className="relative flex items-center gap-3">
        <BrandMark size={38} tone="on-dark" />
        <div>
          <div className="font-display text-[18px] font-semibold leading-tight tracking-tight text-white">
            BimDossier
          </div>
          <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-white/60">
            Wet kwaliteitsborging voor het bouwen (Wkb)-compliant BIM platform
          </div>
        </div>
      </div>

      <div className="relative mt-6 flex min-h-0 flex-1 flex-col items-stretch gap-6 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div
            className="inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em]"
            style={{
              color: 'var(--header-status-success-fg)',
              background: 'var(--header-status-success-bg)',
              borderColor: 'var(--header-status-success-border)',
            }}
          >
            <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: 'var(--header-status-success-dot)' }} />
            Wet kwaliteitsborging voor het bouwen (Wkb) {sysStatus.wkb} ready
          </div>

          <h1
            className="m-0 font-display font-medium leading-[1.04] tracking-tight text-white"
            style={{
              fontSize: 'clamp(22px, 2.6vw, 40px)',
              textWrap: 'pretty',
            }}
          >
            Stitch your{' '}
            <span className="italic" style={{ color: 'var(--header-status-info-dot)' }}>models</span>,{' '}
            <span className="italic" style={{ color: 'var(--header-status-info-dot)' }}>issues</span> and{' '}
            <span className="italic" style={{ color: 'var(--header-status-info-dot)' }}>dossier</span>{' '}
            into one Wet kwaliteitsborging voor het bouwen (Wkb) record.
          </h1>

          <p
            className="leading-snug text-white/70"
            style={{ fontSize: 'clamp(12.5px, 1vw, 15px)' }}
          >
            Federated IFC review, automated Bouwbesluit checks and a delivery-ready
            consumentendossier&nbsp;&mdash; for builders working under the Wet kwaliteitsborging voor het bouwen (Wkb).
          </p>

          <KpiStrip
            tone="on-dark"
            items={[
              { label: 'Wkb', value: sysStatus.wkb },
              { label: 'BBL', value: sysStatus.bbl, valueColor: 'var(--header-status-info-dot)' },
              { label: 'IFC', value: sysStatus.ifc, valueColor: 'var(--header-status-info-dot)' },
              {
                label: 'Status',
                value: statusLabel,
                valueColor:
                  sysStatus.status === 'normal' ? 'var(--header-status-success-fg)'
                    : sysStatus.status === 'degraded' ? 'var(--header-status-warning-dot)'
                      : sysStatus.status === 'down' ? 'var(--header-status-error-dot)'
                        : 'var(--header-status-info-fg)',
              },
            ]}
          />
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center">
          <div
            className="flex flex-col"
            style={{
              width: 'calc(min(70vh, 45vw) * (612.54211 / 723.61865))',
            }}
          >
            <div
              style={{
                height: 'min(70vh, 45vw)',
                aspectRatio: '612.54211 / 723.61865',
              }}
            >
              <NetherlandsMap
                responsiveHeight="100%"
                fill="var(--color-primary-light, #e5ecf6)"
                markers={markers}
                animatePulse
                ariaLabel="Live BimDossier project locations across the Netherlands"
                className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.30)]"
              />
            </div>
            <div
              className="mt-5 whitespace-nowrap text-right font-sans text-[12.5px] uppercase tracking-[0.10em] text-white/55"
              style={{ visibility: markers.length > 0 ? 'visible' : 'hidden' }}
              aria-hidden={markers.length === 0}
            >
              {formatApproxCount(totalProjects)} projects &middot;{' '}
              {formatApproxCount(markers.length)} cities live
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-6">
        <LegalFooter
          tone="on-dark"
          links={[...LEGAL_LINKS]}
          tail={`Wet kwaliteitsborging voor het bouwen (Wkb) ${sysStatus.wkb}`}
        />
      </div>
    </>
  );
}
