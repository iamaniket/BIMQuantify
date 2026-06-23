'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarDays, FileText, Layers, MapPin, RefreshCw, Ruler, Truck } from '@bimstitch/ui/icons';
import { Link } from '@/i18n/navigation';
import { useCallback, useEffect, useState, type JSX } from 'react';

import {
  Card, CardBody, CardFooter, Icon,
} from '@bimstitch/ui';

import { AvatarStack } from '@/components/shared/AvatarStack';
import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import { listModels } from '@/lib/api/models';
import { getProject } from '@/lib/api/projects';
import { listDeadlines } from '@/lib/api/deadlines';
import { listAttachments } from '@/lib/api/attachments';
import { listFindings } from '@/lib/api/findings';
import { listCertificates } from '@/lib/api/certificates';
import type { Project, ProjectMember } from '@/lib/api/schemas';
import { modelsKey } from '@/features/models/queryKeys';
import { attachmentsKey } from '@/features/attachments/queryKeys';
import { findingsKey } from '@/features/findings/queryKeys';
import { certificatesKey } from '@/features/certificates/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import { isWithinNetherlands, pdokAerialThumbnailUrl } from '@/features/jurisdictions/nl/mapThumbnail';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';

import { projectKey, projectDeadlinesKey } from './queryKeys';

import {
  formatProjectBadgeLabel,
  isProjectArchived,
  projectBadgeClasses,
  projectDotClasses,
} from '@/lib/formatting/projects';
import { formatDate } from '@/lib/formatting/dates';

function displayMemberName(member: ProjectMember): string {
  const fullName = member.full_name === null ? '' : member.full_name.trim();
  return fullName.length > 0 ? fullName : member.email;
}

function sortMembersForCard(members: ProjectMember[], ownerId: string): ProjectMember[] {
  return [...members].sort((a, b) => {
    const aPriority = a.user_id === ownerId || a.role === 'owner' ? 0 : 1;
    const bPriority = b.user_id === ownerId || b.role === 'owner' ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aCreated = Date.parse(a.created_at);
    const bCreated = Date.parse(b.created_at);
    const safeACreated = Number.isNaN(aCreated) ? Number.MAX_SAFE_INTEGER : aCreated;
    const safeBCreated = Number.isNaN(bCreated) ? Number.MAX_SAFE_INTEGER : bCreated;
    return safeACreated - safeBCreated;
  });
}

type Props = {
  project: Project;
  members?: ProjectMember[];
};

export function ProjectCard({ project, members = [] }: Props): JSX.Element {
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const { tokens } = useAuth();
  const tPhases = useTranslations('projects.phases');
  const archived = isProjectArchived(project);
  const createdLabel = formatDate(project.created_at, locale, '');
  const updatedLabel = formatDate(project.updated_at, locale, '');
  const deliveryLabel = project.delivery_date === null ? '' : formatDate(project.delivery_date, locale, '');
  const cityLine = project.city ?? null;
  const sortedMembers = sortMembersForCard(members, project.owner_id);
  const avatarMembers = sortedMembers.map((m, i) => ({
    id: m.user_id,
    name: displayMemberName(m),
    isLead: i === 0,
  }));
  const thumbnailClassName = archived
    ? 'h-36 w-full object-cover grayscale transition-transform duration-300 group-hover:scale-[1.03]'
    : 'h-36 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]';
  const emptyStateClassName = archived
    ? 'flex h-36 items-center justify-center gap-3 bg-gradient-to-br from-background-secondary to-background-tertiary grayscale'
    : 'flex h-36 items-center justify-center gap-3 bg-gradient-to-br from-background-secondary to-background-tertiary';

  // Warm every query the project-detail page mounts so its panels are already
  // populated by the time navigation completes. Best-effort: clicking without
  // hovering simply falls back to the page's own on-mount fetches. Each query
  // reuses the same key + api fn (and page size) as its feature hook so the
  // detail page reads straight from cache rather than refetching.
  const prefetchProject = useCallback(() => {
    if (tokens === null) return;
    const { access_token: accessToken } = tokens;
    const { id } = project;
    const swallow = (): undefined => undefined;
    const page = (offset: number): { limit: number; offset: number } => ({ limit: 50, offset });

    queryClient
      .prefetchQuery({
        queryKey: projectKey(id),
        queryFn: () => getProject(accessToken, id),
        staleTime: 30_000,
      })
      .catch(swallow);
    queryClient
      .prefetchQuery({
        queryKey: modelsKey(id),
        queryFn: () => listModels(accessToken, id),
        staleTime: 30_000,
      })
      .catch(swallow);
    queryClient
      .prefetchQuery({
        queryKey: projectDeadlinesKey(id),
        queryFn: () => listDeadlines(accessToken, id),
        staleTime: 30_000,
      })
      .catch(swallow);
    queryClient
      .prefetchInfiniteQuery({
        queryKey: [...attachmentsKey(id), 'all'] as const,
        queryFn: ({ pageParam }) => listAttachments(accessToken, id, page(pageParam)),
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        staleTime: 30_000,
      })
      .catch(swallow);
    queryClient
      .prefetchInfiniteQuery({
        queryKey: findingsKey(id),
        queryFn: ({ pageParam }) => listFindings(accessToken, id, page(pageParam)),
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        staleTime: 30_000,
      })
      .catch(swallow);
    queryClient
      .prefetchInfiniteQuery({
        queryKey: [...certificatesKey(id), 'all'] as const,
        queryFn: ({ pageParam }) => listCertificates(accessToken, id, page(pageParam)),
        initialPageParam: 0,
        getNextPageParam: () => undefined,
        staleTime: 30_000,
      })
      .catch(swallow);
  }, [tokens, queryClient, project]);

  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [aerialFailed, setAerialFailed] = useState(false);
  // Clear the failed flags when the source changes, otherwise one <img> error
  // (e.g. an expired presigned URL after S3_PRESIGN_TTL_SECONDS) pins the map
  // fallback forever — even after a refetch delivers a fresh, loadable URL.
  useEffect(() => { setThumbnailFailed(false); }, [project.thumbnail_url]);
  useEffect(() => { setAerialFailed(false); }, [project.latitude, project.longitude]);
  const showThumbnail = project.thumbnail_url !== null && !thumbnailFailed;
  const aerialUrl = (
    !showThumbnail
    && project.latitude !== null
    && project.longitude !== null
    && isWithinNetherlands(project.latitude, project.longitude)
    && !aerialFailed
  )
    ? pdokAerialThumbnailUrl(project.latitude, project.longitude, { width: 600, height: 280 })
    : null;

  return (
    <Card className="group relative min-w-[340px] overflow-hidden border-border bg-background transition-all duration-200 hover:-translate-y-1 hover:border-primary-light hover:shadow-xl hover:shadow-primary/15" onMouseEnter={prefetchProject}>
      <Link
        href={`/projects/${project.id}`}
        className="flex flex-1 flex-col gap-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative bg-background-secondary">
          <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-primary px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-primary-foreground shadow-sm shadow-primary/20 transition-colors duration-200 group-hover:bg-primary-hover">
              <span className={`h-1.5 w-1.5 rounded-full ${projectDotClasses(project)}`} />
              {formatProjectBadgeLabel(project, tPhases(project.phase))}
            </span>
          </div>

          {showThumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnail_url!}
              alt=""
              className={thumbnailClassName}
              onError={() => setThumbnailFailed(true)}
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
              <Building2 className="h-10 w-10 text-foreground-tertiary" weight="regular" />
              <Layers className="h-7 w-7 text-border" weight="regular" />
              <Ruler className="h-6 w-6 text-border" weight="regular" />
            </div>
          )}
        </div>

        <CardBody className="relative gap-4 border-t border-primary bg-primary text-primary-foreground transition-colors duration-200 group-hover:bg-primary-hover">
          <BlueprintTexture className="opacity-[0.14]" toneClassName="text-white" />
          <div className="relative grid min-w-0 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0 space-y-2">
              <div className="space-y-1.5">
                {project.lifecycle_state === 'archived' && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${projectBadgeClasses(project)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${projectDotClasses(project)}`} />
                    Archived · read only
                  </span>
                )}
                <h3 className="line-clamp-2 break-all text-title3 font-semibold text-primary-foreground">
                  {project.name}
                </h3>
                {project.reference_code !== null && (
                  <p className="line-clamp-1 break-all text-caption font-sans text-primary-foreground/75">
                    {project.reference_code}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-1.5 pt-1 text-body3 text-primary-foreground/85">
                {project.permit_number !== null && (
                  <p className="inline-flex min-w-0 items-center gap-1.5 line-clamp-1 break-all">
                    <Icon icon={FileText} size="md" weight="regular" className="text-white/80" />
                    {project.permit_number}
                  </p>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-2 text-body3 text-primary-foreground/85">
              {cityLine !== null && (
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Icon icon={MapPin} size="xs" weight="regular" className="text-white/80" />
                    <span className="line-clamp-1 break-all">{cityLine}</span>
                  </span>
                </div>
              )}

              {project.description !== null && project.description.length > 0 && (
                <p className="line-clamp-2 break-words text-body2 text-primary-foreground/85">
                  {project.description}
                </p>
              )}
            </div>
          </div>
        </CardBody>

        <CardFooter className="relative border-primary-dark bg-primary-hover transition-colors duration-200 group-hover:bg-primary-dark">
          <div className="relative flex w-full items-center gap-3 text-caption text-primary-foreground/85">
            <div className="flex min-w-0 flex-1 gap-3">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon icon={CalendarDays} size="md" weight="regular" className="text-white/80" />
                <span className="min-w-0 truncate font-semibold text-white">{createdLabel === '' ? '-' : createdLabel}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon icon={RefreshCw} size="md" weight="regular" className="text-white/80" />
                <span className="min-w-0 truncate font-semibold text-white">{updatedLabel === '' ? '-' : updatedLabel}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon icon={Truck} size="md" weight="regular" className="text-white/80" />
                <span className="min-w-0 truncate font-semibold text-white">{deliveryLabel === '' ? '-' : deliveryLabel}</span>
              </span>
            </div>
            <AvatarStack members={avatarMembers} />
          </div>
        </CardFooter>
      </Link>
    </Card>
  );
}
