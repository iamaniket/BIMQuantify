'use client';

import {
  Building2, Calendar, Hammer, Layers, MapPin, Ruler,
} from 'lucide-react';
import { useState, type JSX } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';

import type { Project } from '@/lib/api/schemas';

import {
  formatAddress,
  formatDeliveryDate,
} from '@/lib/formatting/projects';
import {
  isWithinNetherlands,
  pdokAerialThumbnailUrl,
} from '@/features/jurisdictions/nl/mapThumbnail';

type Props = {
  project: Project;
};

function formatDate(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

function InfoRow({ icon: Icon, label, value }: {
  icon: typeof MapPin;
  label: string;
  value: string | null;
}): JSX.Element | null {
  if (value === null || value.length === 0) return null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-tertiary" />
      <div className="min-w-0 flex-1">
        <div className="text-caption text-foreground-tertiary">{label}</div>
        <div className="text-body3 text-foreground">{value}</div>
      </div>
    </div>
  );
}

export function ProjectOverviewCard({ project }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const t = useTranslations('projectDetail.tabs.overviewCard');
  const tStatuses = useTranslations('projects.statuses');
  const tPhases = useTranslations('projects.phases');
  const [aerialFailed, setAerialFailed] = useState(false);

  const address = formatAddress(project);
  const deliveryDate = project.delivery_date !== null
    ? formatDeliveryDate(project.delivery_date, locale)
    : null;
  const plannedStart = project.planned_start_date !== null
    ? formatDate(project.planned_start_date, locale)
    : null;

  const showMap =
    project.latitude !== null &&
    project.longitude !== null &&
    isWithinNetherlands(project.latitude, project.longitude) &&
    !aerialFailed;

  const aerialUrl = showMap
    ? pdokAerialThumbnailUrl(project.latitude!, project.longitude!, { width: 600, height: 300 })
    : null;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      {/* Map thumbnail or placeholder */}
      <div className="h-40 shrink-0 overflow-hidden bg-background-secondary">
        {aerialUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={aerialUrl}
            alt={`${project.name} map`}
            className="h-full w-full object-cover"
            onError={() => setAerialFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-3 bg-gradient-to-br from-black/5 via-black/2 to-black/10 dark:from-white/12 dark:via-white/6 dark:to-black/10">
            <Building2 className="h-10 w-10 text-black/30 dark:text-white/60" />
            <Layers className="h-7 w-7 text-black/15 dark:text-white/30" />
            <Ruler className="h-6 w-6 text-black/15 dark:text-white/30" />
          </div>
        )}
      </div>

      {/* Project info */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-4">
        {project.description !== null && project.description.trim().length > 0 && (
          <p className="mb-2 whitespace-pre-line text-body3 text-foreground-secondary">
            {project.description}
          </p>
        )}

        <InfoRow
          icon={MapPin}
          label={t('address')}
          value={address}
        />
        <InfoRow
          icon={Hammer}
          label={t('contractor')}
          value={project.contractor_name}
        />
        <InfoRow
          icon={Building2}
          label={t('status')}
          value={`${tStatuses(project.status)} · ${tPhases(project.phase)}`}
        />
        <InfoRow
          icon={Calendar}
          label={t('plannedStart')}
          value={plannedStart}
        />
        <InfoRow
          icon={Calendar}
          label={t('delivery')}
          value={deliveryDate}
        />
        {project.reference_code !== null && (
          <InfoRow
            icon={Layers}
            label={t('reference')}
            value={project.reference_code}
          />
        )}

        <div className="mt-2 border-t border-border pt-2 text-caption text-foreground-tertiary">
          {t('createdAt', { date: formatDate(project.created_at, locale) })}
        </div>
      </div>
    </div>
  );
}
