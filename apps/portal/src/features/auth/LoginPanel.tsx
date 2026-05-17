'use client';

import { NetherlandsMap, type MapMarker } from '@bimstitch/map';
import {
  AuthShell,
  BrandMark,
  HeroGrid,
  KpiStrip,
  LegalFooter,
  SystemStatusBadge,
  type LegalFooterLink,
  type SystemStatusValue,
} from '@bimstitch/ui';
import type { JSX } from 'react';

import { LoginForm } from '@/features/auth/LoginForm';
import { useProjectsMap } from '@/features/auth/useProjectsMap';
import { useSystemStatus } from '@/features/auth/useSystemStatus';
import { env } from '@/lib/env';
import { formatApproxCount } from '@/lib/formatting/numbers';

interface LoginPanelProps {
  legalLinks: readonly LegalFooterLink[];
}

export function LoginPanel({ legalLinks }: LoginPanelProps): JSX.Element {
  const statusQuery = useSystemStatus();
  const markersQuery = useProjectsMap();

  const live = statusQuery.data;
  const status: SystemStatusValue = statusQuery.isLoading
    ? 'loading'
    : live?.status ?? 'loading';
  const region = live ? `${live.region} · ${live.node}` : 'EU-WEST · AMS01';
  const wkb = live?.wkb_version ?? '2026.1';
  const bbl = live?.bbl_version ?? 'v2026.04';
  const ifc = live?.ifc_version ?? '4.3';

  const markers: readonly MapMarker[] = markersQuery.data ?? [];
  const totalProjects = markers.reduce((sum, m) => sum + (m.count ?? 1), 0);

  const requestAccessHref = env.NEXT_PUBLIC_MARKETING_URL
    ? `${env.NEXT_PUBLIC_MARKETING_URL.replace(/\/$/, '')}/request-access`
    : '/request-access';

  return (
    <AuthShell
      brand={(
        <>
          <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

          {/*
            Layout strategy:
            - The map is the visual anchor. It targets 70vh tall — capped to
              avoid overflowing extremely tall viewports — and right-anchors
              against the brand pane. CSS `aspect-ratio` keeps it the right
              shape so the column auto-sizes its width from the height.
            - Text sits in the left column. The headline uses a fluid font
              size (`clamp`) so it shrinks when the column shrinks — text
              never collides with the map because the two are independent
              flex columns, not absolute overlays.
            - Top brand row + bottom KPI strip + legal footer span the full
              pane so they get their own vertical space.
          */}

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

            {/*
              The map column.
              - `aspect-ratio` (matching NL viewBox) keeps the SVG correctly
                shaped; the column's width auto-sizes from its height.
              - Height is `min(70vh, ...)` so the map IS 70% of viewport on
                normal screens, but caps so it can't overflow the brand pane
                on very tall windows.
              - `justify-end` right-anchors the map column inside the flex
                row; text occupies the remaining left space, never under it.
            */}
            <div className="flex shrink-0 flex-col items-center justify-center">
              {/* Inner flex-col is pinned to the map's COMPUTED width so the
                  stats strip below right-aligns against the map's right
                  edge — even when the strip's natural text width would
                  otherwise exceed the map. Width = mapHeight × aspectRatio. */}
              <div
                className="flex flex-col"
                style={{
                  width: `calc(min(70vh, 45vw) * (${612.54211} / ${723.61865}))`,
                }}
              >
                <div
                  style={{
                    // Target 70% of viewport HEIGHT. The width cap (45vw)
                    // only kicks in on portrait/narrow viewports where 70vh
                    // would overflow the brand pane. On standard 16:9 and
                    // 16:10 desktops 70vh wins, giving the map true 70% of
                    // the screen height. `aspect-ratio` shapes the box; the
                    // SVG fills it.
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
      )}
      topRight={(
        <>
          <SystemStatusBadge status={status} region={region} tone="on-light" />
          <div className="font-mono text-[11px] text-foreground-tertiary">{region}</div>
        </>
      )}
      form={(
        <>
          <div className="mb-5">
            <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary">
              Sign in
            </div>
            <h2 className="m-0 font-display text-[30px] font-medium leading-tight tracking-tight text-foreground">
              Welcome back.
            </h2>
            <p className="mt-2 text-[13px] leading-snug text-foreground-tertiary">
              Sign in to continue.{' '}
              <span className="whitespace-nowrap">
                New here?{' '}
                <a href={requestAccessHref} className="font-semibold text-primary no-underline">
                  Request access →
                </a>
              </span>
            </p>
          </div>
          <LoginForm />
        </>
      )}
    />
  );
}
