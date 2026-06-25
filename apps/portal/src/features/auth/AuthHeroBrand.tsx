'use client';

import {
  BrandMark,
  HeroGrid,
  KpiStrip,
  LegalFooter,
  SystemStatusBadge,
  type SystemStatusValue,
} from '@bimdossier/brand';
import { NetherlandsMap, NL_ASPECT_RATIO_CSS, type MapMarker } from '@bimdossier/map';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { ReactNode } from 'react';

import { useProjectsMap } from '@/features/auth/useProjectsMap';
import { useSystemStatus } from '@/features/auth/useSystemStatus';
import { formatApproxCount } from '@/lib/formatting/numbers';

/**
 * Shared "brand canvas" content for `AuthShell.brand` — the dark blue
 * pane with the BimDossier wordmark, hero copy, KPI strip, live NL map,
 * and the legal footer.
 *
 * Used by every non-dashboard auth page so they share an identical
 * left-pane experience. Lives outside `@bimdossier/ui` because it depends
 * on portal-specific data hooks (system status, projects map).
 */
export function AuthHeroBrand(): JSX.Element {
  const t = useTranslations('auth');
  const tLegal = useTranslations('legal');
  const statusQuery = useSystemStatus();
  const markersQuery = useProjectsMap();

  const legalLinks = [
    { href: '/legal/privacy', label: tLegal('navPrivacy') },
    { href: '/legal/terms', label: tLegal('navTerms') },
    { href: '/legal/dpa', label: tLegal('navDpa') },
  ];

  const live = statusQuery.data;
  const status: SystemStatusValue = statusQuery.isLoading
    ? 'loading'
    : live?.status ?? 'loading';
  const wkb = live?.wkb_version ?? '2026.1';
  const bbl = live?.bbl_version ?? 'v2026.04';
  const ifc = live?.ifc_version ?? '4.3';

  const markers: readonly MapMarker[] = markersQuery.data ?? [];
  const totalProjects = markers.reduce((sum, m) => sum + (m.count ?? 1), 0);

  const statusLabel =
    status === 'normal' ? t('kpi.statusNormal')
    : status === 'degraded' ? t('kpi.statusDegraded')
    : status === 'down' ? t('kpi.statusDown')
    : t('kpi.statusUnknown');

  return (
    <>
      <HeroGrid opacity={0.1} stroke="#ffffff" step={36} />

      {/* Top: brand row */}
      <div className="relative flex items-center gap-3">
        <BrandMark size={42} plate />
        <div>
          <div className="font-display text-[20px] font-semibold leading-tight tracking-tight text-white">
            BimDossier
          </div>
          <div className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.10em] text-white/60">
            {t('brand.tagline')}
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
              color: 'var(--header-status-success-fg)',
              background: 'var(--header-status-success-bg)',
              borderColor: 'var(--header-status-success-border)',
            }}
          >
            <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ background: 'var(--header-status-success-dot)' }} />
            {t('hero.readyBadge', { version: wkb })}
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
            {t.rich('hero.headlineTemplate', {
              em: (chunks) => (
                <span className="italic" style={{ color: 'var(--header-status-info-dot)' }}>{chunks}</span>
              ),
            })}
          </h1>

          <p
            className="leading-snug text-white/70"
            style={{ fontSize: 'clamp(12.5px, 1vw, 15px)' }}
          >
            {t('hero.subhead')}
          </p>

          <KpiStrip
            tone="on-dark"
            items={[
              { label: t('kpi.wkb'), value: wkb },
              { label: t('kpi.bbl'), value: bbl, valueColor: 'var(--header-status-info-dot)' },
              { label: t('kpi.ifc'), value: ifc, valueColor: 'var(--header-status-info-dot)' },
              {
                label: t('kpi.status'),
                value: statusLabel,
                valueColor:
                  status === 'normal' ? 'var(--header-status-success-fg)'
                  : status === 'degraded' ? 'var(--header-status-warning-dot)'
                  : status === 'down' ? 'var(--header-status-error-dot)'
                  : 'var(--header-status-info-fg)',
              },
            ]}
          />
        </div>

        {/* Map column — hidden on mobile/tablet so the brand pane stays
            within the viewport and the form is immediately reachable. */}
        <div className="hidden lg:flex shrink-0 flex-col items-center justify-center">
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
                fill="var(--color-primary-light, #e5ecf6)"
                markers={markers}
                animatePulse
                ariaLabel="Live BimDossier project locations across the Netherlands"
                className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.30)]"
              />
            </div>
            {/* Always rendered with reserved space — visibility-toggled
                so the map doesn't jump when the API call resolves. */}
            <div
              className="mt-5 whitespace-nowrap text-right font-sans text-[12.5px] uppercase tracking-[0.10em] text-white/55"
              style={{
                visibility:
                  markersQuery.isSuccess && markers.length > 0 ? 'visible' : 'hidden',
              }}
              aria-hidden={!(markersQuery.isSuccess && markers.length > 0)}
            >
              {t('map.liveCaption', {
                projects: formatApproxCount(totalProjects),
                cities: formatApproxCount(markers.length),
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: legal footer */}
      <div className="relative mt-6">
        <LegalFooter
          tone="on-dark"
          links={legalLinks}
          tail={`Wet kwaliteitsborging voor het bouwen (Wkb) ${wkb}`}
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
  const t = useTranslations('auth.systemStatus');
  const statusQuery = useSystemStatus();
  const live = statusQuery.data;
  const status: SystemStatusValue = statusQuery.isLoading
    ? 'loading'
    : live?.status ?? 'loading';
  const region = live ? `${live.region} · ${live.node}` : undefined;

  const statusLabels: Record<SystemStatusValue, string> = {
    normal: t('normal'),
    degraded: t('degraded'),
    down: t('down'),
    loading: t('loading'),
  };

  return (
    <>
      <SystemStatusBadge status={status} tone="on-light" labels={statusLabels} />
      {trailing !== undefined ? (
        trailing
      ) : region ? (
        <div className="font-sans text-[11px] text-foreground-tertiary">{region}</div>
      ) : null}
    </>
  );
}
