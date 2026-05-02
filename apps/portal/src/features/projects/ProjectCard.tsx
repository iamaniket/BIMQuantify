'use client';

import {
  Building2, CalendarDays, FileText, Layers, MapPin, RefreshCw, Ruler, Truck,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useState, type JSX } from 'react';

import {
  Card, CardBody, CardFooter, Icon,
} from '@bimstitch/ui';

import { BlueprintTexture } from '@/components/BlueprintTexture';
import type { Project } from '@/lib/api/schemas';
import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/lib/mapThumbnail';
import { useLocale, useTranslations } from 'next-intl';

import { ProjectCardMenu } from './ProjectCardMenu';
import {
  formatProjectBadgeLabel,
  isProjectArchived,
  projectBadgeClasses,
  projectDotClasses,
} from './projectFormatting';

function formatDateLabel(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

type Props = {
  project: Project;
};

export function ProjectCard({ project }: Props): JSX.Element {
  const locale = useLocale();
  const tStatuses = useTranslations('projects.statuses');
  const tPhases = useTranslations('projects.phases');
  const archived = isProjectArchived(project);
  const createdLabel = formatDateLabel(project.created_at, locale);
  const updatedLabel = formatDateLabel(project.updated_at, locale);
  const deliveryLabel = project.delivery_date === null ? '' : formatDateLabel(project.delivery_date, locale);
  const cityLine = project.city ?? null;
  const contractorName = project.contractor_name ?? null;
  const thumbnailClassName = archived
    ? 'h-36 w-full object-cover grayscale transition-transform duration-300 group-hover:scale-[1.03]'
    : 'h-36 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]';
  const emptyStateClassName = archived
    ? 'flex h-36 items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-100 grayscale'
    : 'flex h-36 items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-100';

  const [aerialFailed, setAerialFailed] = useState(false);
  const aerialUrl = (
    project.thumbnail_url === null
    && project.latitude !== null
    && project.longitude !== null
    && isWithinNetherlands(project.latitude, project.longitude)
    && !aerialFailed
  )
    ? pdokAerialThumbnailUrl(project.latitude, project.longitude, { width: 600, height: 280 })
    : null;

  return (
    <Card className="group relative overflow-hidden border-border bg-background transition-all duration-200 hover:-translate-y-1 hover:border-primary-light hover:shadow-xl hover:shadow-primary/15">
      <Link
        href={`/projects/${project.id}`}
        className="flex flex-col gap-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative bg-background-secondary">
          <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-sm shadow-primary/20 transition-colors duration-200 group-hover:bg-primary-hover">
              <span className={`h-1.5 w-1.5 rounded-full ${projectDotClasses(project)}`} />
              {formatProjectBadgeLabel(project, tStatuses(project.status))}
            </span>
          </div>

          {project.thumbnail_url !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url}
              alt=""
              className={thumbnailClassName}
            />
          ) : aerialUrl !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={aerialUrl}
              alt=""
              className={thumbnailClassName}
              onError={() => setAerialFailed(true)}
            />
          ) : (
            <div className={emptyStateClassName}>
              <Building2 className="h-10 w-10 text-slate-300" />
              <Layers className="h-7 w-7 text-slate-200" />
              <Ruler className="h-6 w-6 text-slate-200" />
            </div>
          )}
        </div>

        <CardBody className="relative gap-4 border-t border-primary bg-primary text-primary-foreground transition-colors duration-200 group-hover:bg-primary-hover">
          <BlueprintTexture className="opacity-[0.14]" toneClassName="text-white" />
          <div className="relative grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0 space-y-3">
              <div className="space-y-1.5">
                {project.lifecycle_state === 'archived' && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${projectBadgeClasses(project)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${projectDotClasses(project)}`} />
                    Archived · read only
                  </span>
                )}
                <h3 className="text-title3 font-semibold text-primary-foreground">
                  {project.name}
                </h3>
                {project.reference_code !== null && (
                  <p className="text-caption font-mono text-primary-foreground/75">
                    {project.reference_code}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-1.5 pt-1 text-body3 text-primary-foreground/85">
                <p className="inline-flex items-center gap-1.5">
                  <Icon icon={Layers} size="sm" className="text-white/80" />
                  {tPhases(project.phase)}
                </p>
                {project.permit_number !== null && (
                  <p className="inline-flex items-center gap-1.5 line-clamp-1">
                    <Icon icon={FileText} size="sm" className="text-white/80" />
                    {project.permit_number}
                  </p>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-2 text-body3 text-primary-foreground/85">
              {(cityLine !== null || contractorName !== null) && (
                <div className="flex flex-col gap-0.5">
                  {cityLine !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Icon icon={MapPin} size="xs" className="text-white/80" />
                      {cityLine}
                    </span>
                  )}
                  {contractorName !== null && (
                    <span className="line-clamp-2 text-primary-foreground/75">
                      {contractorName}
                    </span>
                  )}
                </div>
              )}

              {project.description !== null && project.description.length > 0 && (
                <p className="line-clamp-3 text-body2 text-primary-foreground/85">
                  {project.description}
                </p>
              )}
            </div>
          </div>
        </CardBody>

        <CardFooter className="relative border-primary-dark bg-primary-hover transition-colors duration-200 group-hover:bg-primary-dark">
          <div className="relative flex w-full items-center justify-between gap-3 text-caption text-primary-foreground/85">
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={CalendarDays} size="sm" className="text-white/80" />
              <span className="font-semibold text-white">{createdLabel === '' ? '-' : createdLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={RefreshCw} size="sm" className="text-white/80" />
              <span className="font-semibold text-white">{updatedLabel === '' ? '-' : updatedLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon icon={Truck} size="sm" className="text-white/80" />
              <span className="font-semibold text-white">{deliveryLabel === '' ? '-' : deliveryLabel}</span>
            </span>
          </div>
        </CardFooter>
      </Link>
      <ProjectCardMenu project={project} />
    </Card>
  );
}
