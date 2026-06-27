'use client';

import {
  BrandMark,
  HeroGrid,
  KpiStrip,
  LegalFooter,
} from '@bimdossier/brand';
import { NetherlandsMap, NL_ASPECT_RATIO_CSS, type MapMarker } from '@bimdossier/map';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import { fetchProjectsMap, fetchSystemStatus } from '@/lib/api';
import { formatApproxCount } from '@/lib/formatting/numbers';

type StatusState = {
  status: 'normal' | 'degraded' | 'down' | 'loading';
  wkbChecks: number | null;
  bblChecks: number | null;
  ifcSchemas: readonly string[];
};

// Real coverage figures come from the API. When it's unreachable the marketing
// page degrades to em-dashes rather than baking (and risking drift on) numbers.
const STATUS_DEFAULTS: StatusState = {
  status: 'loading',
  wkbChecks: null,
  bblChecks: null,
  ifcSchemas: [],
};

/** "IFC2X3" / "IFC4" / "IFC4X3" -> "2x3 / 4 / 4x3" (em-dash when unknown). */
function formatIfcSchemas(schemas: readonly string[]): string {
  if (schemas.length === 0) return '—';
  return schemas.map((s) => s.replace(/^IFC/i, '').toLowerCase()).join(' / ');
}

/** System-status → `brandPanel.status.*` catalog key. */
const STATUS_LABEL_KEY: Record<StatusState['status'], string> = {
  normal: 'status.normal',
  degraded: 'status.degraded',
  down: 'status.outage',
  loading: 'status.unknown',
};

/** System-status → KPI value color token. */
const STATUS_COLOR: Record<StatusState['status'], string> = {
  normal: 'var(--header-status-success-fg)',
  degraded: 'var(--header-status-warning-dot)',
  down: 'var(--header-status-error-dot)',
  loading: 'var(--header-status-info-fg)',
};

export function MarketingBrandPanel(): JSX.Element {
  const t = useTranslations('brandPanel');
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
          wkbChecks: live.wkb_checks,
          bblChecks: live.bbl_checks,
          ifcSchemas: live.ifc_schemas,
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

  const statusLabel = t(STATUS_LABEL_KEY[sysStatus.status]);

  const legalLinks = [
    { href: '/legal/privacy', label: t('legal.privacy') },
    { href: '/legal/terms', label: t('legal.terms') },
    { href: '/legal/dpa', label: t('legal.dpa') },
  ];

  return (
    <>
      <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

      <div className="relative flex items-center gap-4">
        <BrandMark size={50} variant="white" />
        <div>
          <div className="font-display text-[24px] font-semibold leading-tight tracking-tight text-white">
            {t('brand')}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold uppercase tracking-[0.10em] text-white/60">
            {t('eyebrow')}
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
            {t('statusChecks', { wkb: sysStatus.wkbChecks ?? '—', bbl: sysStatus.bblChecks ?? '—' })}
          </div>

          <h1
            className="m-0 font-display font-medium leading-[1.04] tracking-tight text-white"
            style={{
              fontSize: 'clamp(22px, 2.6vw, 40px)',
              textWrap: 'pretty',
            }}
          >
            {t.rich('headline', {
              em: (chunks) => (
                <span className="italic" style={{ color: 'var(--header-status-info-dot)' }}>
                  {chunks}
                </span>
              ),
            })}
          </h1>

          <p
            className="leading-snug text-white/70"
            style={{ fontSize: 'clamp(12.5px, 1vw, 15px)' }}
          >
            {t('body')}
          </p>

          <KpiStrip
            tone="on-dark"
            items={[
              { label: t('kpiWkb'), value: sysStatus.wkbChecks ?? '—' },
              { label: t('kpiBbl'), value: sysStatus.bblChecks ?? '—', valueColor: 'var(--header-status-info-dot)' },
              { label: 'IFC', value: formatIfcSchemas(sysStatus.ifcSchemas), valueColor: 'var(--header-status-info-dot)' },
              {
                label: t('kpiStatus'),
                value: statusLabel,
                valueColor: STATUS_COLOR[sysStatus.status],
              },
            ]}
          />
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center">
          <div
            className="flex flex-col"
            style={{
              width: `calc(min(70vh, 45vw) * (${NL_ASPECT_RATIO_CSS}))`,
            }}
          >
            <div
              style={{
                height: 'min(70vh, 45vw)',
                aspectRatio: NL_ASPECT_RATIO_CSS,
              }}
            >
              <NetherlandsMap
                responsiveHeight="100%"
                fill="var(--primary-light)"
                markers={markers}
                animatePulse
                ariaLabel={t('mapAria')}
                className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.30)]"
              />
            </div>
            <div
              className="mt-5 whitespace-nowrap text-right font-sans text-[12.5px] uppercase tracking-[0.10em] text-white/55"
              style={{ visibility: markers.length > 0 ? 'visible' : 'hidden' }}
              aria-hidden={markers.length === 0}
            >
              {t('mapCaption', {
                projects: formatApproxCount(totalProjects),
                cities: formatApproxCount(markers.length),
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-6">
        <LegalFooter
          tone="on-dark"
          links={legalLinks}
          tail={
            sysStatus.wkbChecks != null && sysStatus.bblChecks != null
              ? `${sysStatus.wkbChecks} Wkb · ${sysStatus.bblChecks} BBL`
              : 'Wkb + BBL'
          }
        />
      </div>
    </>
  );
}
