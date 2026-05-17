'use client';

import { NetherlandsMap, type MapMarker } from '@bimstitch/map';
import {
  BrandMark,
  HeroGrid,
  KpiStrip,
  LegalFooter,
  SystemStatusBadge,
  type LegalFooterLink,
  type SystemStatusValue,
} from '@bimstitch/ui';
import type { JSX } from 'react';

import type { ReactNode } from 'react';

import { useProjectsMap } from '@/features/auth/useProjectsMap';
import { useSystemStatus } from '@/features/auth/useSystemStatus';
import { formatApproxCount } from '@/lib/formatting/numbers';

export interface AuthHeroBrandProps {
  /** Legal links rendered in the footer at the bottom of the brand pane. */
  legalLinks: readonly LegalFooterLink[];
}

/**
 * Shared "brand canvas" content for `AuthShell.brand` — the dark blue
 * pane with the BimStitch wordmark, hero copy, KPI strip, live NL map,
 * and the legal footer.
 *
 * Used by both the login page and the legal pages so they share an
 * identical left-pane experience. Lives outside `@bimstitch/ui` because
 * it depends on portal-specific data hooks (system status, projects map).
 */
export function AuthHeroBrand({ legalLinks }: AuthHeroBrandProps): JSX.Element {
  const statusQuery = useSystemStatus();
  const markersQuery = useProjectsMap();

  const live = statusQuery.data;
  const status: SystemStatusValue = statusQuery.isLoading
    ? 'loading'
    : live?.status ?? 'loading';
  const wkb = live?.wkb_version ?? '2026.1';
  const bbl = live?.bbl_version ?? 'v2026.04';
  const ifc = live?.ifc_version ?? '4.3';

  const markers: readonly MapMarker[] = markersQuery.data ?? [];
  const totalProjects = markers.reduce((sum, m) => sum + (m.count ?? 1), 0);

  return (
    <>
      <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

      {/* Top: brand row */}
      <div className="relative flex items-center gap-3">
        <BrandMark size={38} tone="on-dark" />
        <div>
          <div className="font-display text-[18px] font-semibold leading-tight tracking-tight text-white">
            BimStitch
          </div>
          <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-white/60">
            Wkb-compliant BIM platform
          </div>
        </div>
      </div>

      {/* Middle: hero (left text, big map right). On mobile/tablet the
          brand canvas is already stacked above the form by AuthShell —
          we additionally stack TEXT ABOVE MAP inside it so neither
          column gets squeezed below the viewport's effective width. */}
      <div className="relative mt-6 flex min-h-0 flex-1 flex-col items-stretch gap-6 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div
            className="inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em]"
            style={{
              color: '#9ff0bf',
              background: 'rgba(95,217,158,0.16)',
              borderColor: 'rgba(95,217,158,0.32)',
            }}
          >
            <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: '#5fd99e' }} />
            Wkb {wkb} ready
          </div>

          <h1
            className="m-0 font-display font-medium leading-[1.04] tracking-tight text-white"
            style={{
              // Headline scales fluidly with viewport width. Cap kept
              // small so the text column (which competes with the
              // 70vh map) never has to wrap to single-character lines.
              fontSize: 'clamp(22px, 2.6vw, 40px)',
              textWrap: 'pretty',
            }}
          >
            Stitch your <span className="italic" style={{ color: '#9bbce8' }}>models</span>,{' '}
            <span className="italic" style={{ color: '#9bbce8' }}>issues</span> and{' '}
            <span className="italic" style={{ color: '#9bbce8' }}>dossier</span> into one Wkb record.
          </h1>

          <p
            className="leading-snug text-white/70"
            style={{ fontSize: 'clamp(12.5px, 1vw, 15px)' }}
          >
            Federated IFC review, automated Bouwbesluit checks and a delivery-ready
            consumentendossier — for builders working under the Wet Kwaliteits&shy;borging.
          </p>

          <KpiStrip
            tone="on-dark"
            items={[
              { label: 'Wkb', value: wkb },
              { label: 'BBL', value: bbl, valueColor: '#9bbce8' },
              { label: 'IFC', value: ifc, valueColor: '#9bbce8' },
              {
                label: 'Status',
                value:
                  status === 'normal' ? 'Normal'
                  : status === 'degraded' ? 'Degraded'
                  : status === 'down' ? 'Outage'
                  : '—',
                valueColor:
                  status === 'normal' ? '#9ff0bf'
                  : status === 'degraded' ? '#f4c45b'
                  : status === 'down' ? '#f99b8c'
                  : '#cbd5e1',
              },
            ]}
          />
        </div>

        {/* Map column — same layout strategy as login: height-driven via
            `min(70vh, 45vw)` + aspect-ratio, wrapped in a same-width
            container so the stats strip right-aligns against the map. */}
        <div className="flex shrink-0 flex-col items-center justify-center">
          <div
            className="flex flex-col"
            style={{
              width: `calc(min(70vh, 45vw) * (${612.54211} / ${723.61865}))`,
            }}
          >
            <div
              style={{
                height: 'min(70vh, 45vw)',
                aspectRatio: `${612.54211} / ${723.61865}`,
              }}
            >
              <NetherlandsMap
                responsiveHeight="100%"
                fill="var(--color-primary-light, #e5ecf6)"
                markers={markers}
                animatePulse
                ariaLabel="Live BimStitch project locations across the Netherlands"
                className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.30)]"
              />
            </div>
            {/* Always rendered with reserved space — visibility-toggled
                so the map doesn't jump when the API call resolves. */}
            <div
              className="mt-5 whitespace-nowrap text-right font-mono text-[12.5px] uppercase tracking-[0.10em] text-white/55"
              style={{
                visibility:
                  markersQuery.isSuccess && markers.length > 0 ? 'visible' : 'hidden',
              }}
              aria-hidden={!(markersQuery.isSuccess && markers.length > 0)}
            >
              {formatApproxCount(totalProjects)} projects · {formatApproxCount(markers.length)} cities live
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: legal footer */}
      <div className="relative mt-6">
        <LegalFooter
          tone="on-dark"
          links={legalLinks}
          tail={`Wkb ${wkb}`}
        />
      </div>
    </>
  );
}

export interface AuthTopRightProps {
  /**
   * Element rendered on the right side of the top bar. Defaults to the
   * `region · node` mono label (login). Legal pages override this with
   * a back-to-login link.
   */
  trailing?: ReactNode;
}

/**
 * Top-right slot for `AuthShell.topRight` — the live system status badge
 * plus a configurable trailing element (defaults to the region label).
 * Shares its data with `AuthHeroBrand` via React Query's cache.
 */
export function AuthTopRight({ trailing }: AuthTopRightProps = {}): JSX.Element {
  const statusQuery = useSystemStatus();
  const live = statusQuery.data;
  const status: SystemStatusValue = statusQuery.isLoading
    ? 'loading'
    : live?.status ?? 'loading';
  const region = live ? `${live.region} · ${live.node}` : undefined;

  return (
    <>
      <SystemStatusBadge status={status} tone="on-light" />
      {trailing !== undefined ? (
        trailing
      ) : region ? (
        <div className="font-mono text-[11px] text-foreground-tertiary">{region}</div>
      ) : null}
    </>
  );
}
