'use client';

import { NetherlandsMap, type MapMarker } from '@bimdossier/map';
import { MapPin } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { DEMO_PROJECT } from './demoWorkflow';

// The marker is decorative (the map SVG is one `role="img"`), so its data —
// city, project — is duplicated in the adjacent text per the map's contract.
const MARKERS: readonly MapMarker[] = [
  {
    lat: DEMO_PROJECT.lat,
    lng: DEMO_PROJECT.lng,
    label: DEMO_PROJECT.city,
    accent: 'var(--primary)',
    pulse: true,
  },
];

/**
 * Demo-project identity strip above the board: name, gevolgklasse chip, phase
 * and city, plus a compact single-marker Netherlands locator map (hidden below
 * `md`; the always-on marker pulse suppresses itself under reduced motion
 * inside the map package).
 */
export function DemoProjectHeader(): JSX.Element {
  const t = useTranslations('workflowDemo');

  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-border bg-surface-main p-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-title3 font-semibold text-foreground">{DEMO_PROJECT.name}</h3>
          <span className="rounded-full bg-primary-lighter px-2 py-0.5 text-caption font-medium text-primary">
            {DEMO_PROJECT.gevolgklasseLabel}
          </span>
          <span className="rounded-full bg-surface-low px-2 py-0.5 text-caption font-medium text-foreground-secondary ring-1 ring-border">
            {t('project.phase')}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-body3 text-foreground-tertiary">
          <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {t('project.metaCity', { city: DEMO_PROJECT.city })}
        </p>
      </div>

      <div className="hidden shrink-0 md:block">
        <NetherlandsMap
          height={140}
          fill="var(--surface-low)"
          seamStroke="var(--border)"
          markers={MARKERS}
          ariaLabel={t('project.mapLabel', { city: DEMO_PROJECT.city })}
        />
      </div>
    </div>
  );
}
