'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Select } from '@bimstitch/ui';

import type { Column } from '@/components/shared/PageTable';
import { listProjectActivityPage } from '@/lib/api/activity';
import type { ActivityCategory, ProjectActivityEntry } from '@/lib/api/schemas/activity';
import { formatDateTime } from '@/lib/formatting/dates';
import { useTableQuery, type TablePagination } from '@/lib/query/useTableQuery';
import { humanizeResource } from '@/features/projects/detail/ActivityTrendTooltip';
import { projectActivityKey } from '@/features/projects/queryKeys';

/**
 * Shared building blocks for the project activity feed — the column definitions,
 * the server-paginated table hook, the category styling and the filter selects.
 * The dedicated Activity page composes these; kept as standalone pieces so the
 * feed table can be reused elsewhere without re-deriving columns or filters.
 */

export type TimeWindow = 'all' | '1h' | '24h' | '7d' | '30d';
export type TypeFilter = 'all' | ActivityCategory;

export const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100] as const;

const TIME_DURATIONS: Record<Exclude<TimeWindow, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

export function computeSince(window: TimeWindow): string | undefined {
  if (window === 'all') return undefined;
  return new Date(Date.now() - TIME_DURATIONS[window]).toISOString();
}

function categoryStyle(category: string): { bg: string; fg: string; glyph: string } {
  switch (category) {
    case 'upload': return { bg: 'rgba(44,86,151,0.10)', fg: 'var(--primary)', glyph: '↑' };
    case 'scan':   return { bg: 'rgba(95,217,158,0.18)', fg: 'var(--success)', glyph: '✓' };
    case 'create': return { bg: 'rgba(95,136,178,0.16)', fg: 'var(--info)', glyph: '+' };
    case 'change': return { bg: 'rgba(169,116,40,0.16)', fg: 'var(--warning)', glyph: '✎' };
    case 'delete': return { bg: 'rgba(201,71,54,0.14)', fg: 'var(--error)', glyph: '×' };
    default:       return { bg: 'var(--surface-high)', fg: 'var(--foreground-secondary)', glyph: '·' };
  }
}

const CATEGORY_LABEL_KEY: Record<ActivityCategory, string> = {
  upload: 'typeUploads',
  scan: 'typeScans',
  create: 'typeCreate',
  change: 'typeChanges',
  delete: 'typeDelete',
};

const ACTION_I18N_KEY: Record<string, string> = {
  'model.created': 'modelCreated',
  'model.updated': 'modelUpdated',
  'model.deleted': 'modelDeleted',
  'project_file.completed': 'fileCompleted',
  'project_file.rejected': 'fileRejected',
  'project_file.deleted': 'fileDeleted',
  'project_file.version_restored': 'fileVersionRestored',
  'project_file.extraction_succeeded': 'extractionSucceeded',
  'project_file.extraction_failed': 'extractionFailed',
  'compliance.checked': 'complianceChecked',
  'report.created': 'reportCreated',
  'report.signed': 'reportSigned',
  'attachment.completed': 'attachmentCompleted',
  'attachment.rejected': 'attachmentRejected',
  'attachment.updated': 'attachmentUpdated',
  'attachment.deleted': 'attachmentDeleted',
  'certificate.completed': 'certificateCompleted',
  'certificate.rejected': 'certificateRejected',
  'certificate.version_added': 'certificateVersionAdded',
  'certificate.linked_from_library': 'certificateLinked',
  'certificate.updated': 'certificateUpdated',
  'certificate.deleted': 'certificateDeleted',
  'finding.created': 'findingCreated',
  'finding.updated': 'findingUpdated',
  'finding.promoted': 'findingPromoted',
  'finding.resolved': 'findingResolved',
  'finding.verified': 'findingVerified',
  'finding.deleted': 'findingDeleted',
  'risk.created': 'riskCreated',
  'risk.updated': 'riskUpdated',
  'risk.deleted': 'riskDeleted',
  'bcf_topic.created': 'bcfTopicCreated',
  'bcf_topic.updated': 'bcfTopicUpdated',
  'bcf_topic.deleted': 'bcfTopicDeleted',
  'bcf.imported': 'bcfImported',
  'bcf_comment.created': 'bcfCommentCreated',
  'borgingsplan.generated': 'planGenerated',
  'borgingsplan.updated': 'planUpdated',
  'borgingsplan.published': 'planPublished',
  'borgingsplan.superseded': 'planSuperseded',
  'borgingsplan.reset': 'planReset',
  'borgingsmoment.created': 'momentCreated',
  'borgingsmoment.updated': 'momentUpdated',
  'borgingsmoment.deleted': 'momentDeleted',
  'borgingsmoment.reordered': 'momentsReordered',
  'checklist_item.created': 'checklistItemCreated',
  'checklist_item.updated': 'checklistItemUpdated',
  'checklist_item.deleted': 'checklistItemDeleted',
  'checklist_item.reordered': 'checklistItemsReordered',
  'inspection.started': 'inspectionStarted',
  'inspection_result.submitted': 'inspectionResultSubmitted',
  'inspection.completed': 'inspectionCompleted',
  'capture_link.created': 'captureLinkCreated',
  'capture_link.revoked': 'captureLinkRevoked',
  'deadline.filed': 'deadlineFiled',
  'project.created': 'projectCreated',
  'project.updated': 'projectUpdated',
  'project.deleted': 'projectDeleted',
  'project.archived': 'projectArchived',
  'project.reactivated': 'projectReactivated',
  'project.thumbnail_updated': 'projectThumbnailUpdated',
  'project_member.added': 'projectMemberAdded',
  'project_member.removed': 'projectMemberRemoved',
  'project_member.role_changed': 'projectMemberRoleChanged',
  'project_invitation.created': 'projectInvitationCreated',
};

function descriptionParams(entry: ProjectActivityEntry): Record<string, string> {
  // Updates carry `after`; deletes carry only `before`. Merge so labels that
  // interpolate a name/title/filename still render for delete events (after
  // wins on conflict).
  const snap = { ...(entry.before ?? {}), ...(entry.after ?? {}) };
  return {
    name: String(snap['name'] ?? ''),
    filename: String(snap['original_filename'] ?? ''),
    framework: String(snap['framework'] ?? ''),
    title: String(snap['title'] ?? ''),
    count: String(snap['imported_count'] ?? ''),
  };
}

export type ActivityFilters = {
  category: ActivityCategory | undefined;
  q: string | undefined;
  since: string | undefined;
};

/** Debounce a fast-changing value so each keystroke doesn't fire a server query.
 * The Input stays controlled by the raw value; only this delayed copy feeds the
 * query filters. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(value); }, delayMs);
    return () => { clearTimeout(id); };
  }, [value, delayMs]);
  return debounced;
}

/** Server-paginated activity feed for a project, plus the time-window + category
 * + search state that drives it. Shared by the detail-page card and the dedicated
 * Activity page so both query and paginate identically. */
export function useActivityTable(projectId: string): {
  table: TablePagination<ProjectActivityEntry>;
  timeWindow: TimeWindow;
  setTimeWindow: (window: TimeWindow) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (filter: TypeFilter) => void;
  search: string;
  setSearch: (value: string) => void;
} {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const since = useMemo(() => computeSince(timeWindow), [timeWindow]);
  const filters = useMemo<ActivityFilters>(
    () => ({
      category: typeFilter === 'all' ? undefined : typeFilter,
      q: debouncedSearch.trim() || undefined,
      since,
    }),
    [typeFilter, debouncedSearch, since],
  );

  const table = useTableQuery<ProjectActivityEntry, ActivityFilters>({
    filters,
    queryKey: (params) => projectActivityKey(projectId, params),
    queryFn: (token, params) => listProjectActivityPage(token, projectId, params),
    initialPageSize: PAGE_SIZE_OPTIONS[0],
    initialSort: { key: 'created_at', dir: 'desc' },
    enabled: projectId.length > 0,
    // Catch events with no local mutation / WS push to this client (cross-user
    // edits, background-sweep audit rows) when the user refocuses the tab.
    refetchOnWindowFocus: true,
  });

  return { table, timeWindow, setTimeWindow, typeFilter, setTypeFilter, search, setSearch };
}

/** The 5-column activity feed table (When / Actor / Type / Resource / Activity).
 * A hook because every cell label is localized via `useTranslations`. */
export function useActivityColumns(): Column<ProjectActivityEntry>[] {
  const t = useTranslations('activity');
  const locale = useLocale() as Locale;

  return [
    {
      header: t('colWhen'),
      sortKey: 'created_at',
      className: 'whitespace-nowrap font-sans text-caption text-foreground-tertiary',
      cell: (entry) => formatDateTime(entry.created_at, locale),
    },
    {
      header: t('colActor'),
      className: 'max-w-[200px] font-sans text-body3 text-foreground-secondary',
      cell: (entry) => (
        <div className="truncate" title={entry.actor_name ?? t('systemActor')}>
          {entry.actor_name ?? t('systemActor')}
        </div>
      ),
    },
    {
      header: t('colType'),
      sortKey: 'action',
      className: 'font-sans text-body3',
      cell: (entry) => {
        const s = categoryStyle(entry.category);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] text-[11px] font-bold"
              style={{ background: s.bg, color: s.fg }}
            >
              {s.glyph}
            </span>
            <span className="text-foreground-secondary">{t(CATEGORY_LABEL_KEY[entry.category])}</span>
          </span>
        );
      },
    },
    {
      header: t('colResource'),
      sortKey: 'resource_type',
      className: 'max-w-[180px] font-sans text-body3 text-foreground-secondary',
      // activity.resource.<type> labels exist for the known resource types;
      // anything new title-cases the raw code rather than crashing on a miss.
      cell: (entry) => {
        const key = `resource.${entry.resource_type}`;
        const label = t.has(key) ? t(key) : humanizeResource(entry.resource_type);
        return <div className="truncate" title={label}>{label}</div>;
      },
    },
    {
      header: t('colActivity'),
      // The widest column under `table-auto`; capped so it ellipsizes long file
      // names on one line and shares slack with the other columns instead of
      // ballooning. The full text is available on hover via title.
      className: 'max-w-[480px] font-sans text-body3',
      cell: (entry) => {
        const i18nKey = ACTION_I18N_KEY[entry.action];
        const description = i18nKey !== undefined ? t(i18nKey, descriptionParams(entry)) : entry.action;
        return (
          <div className="truncate text-foreground" title={description}>
            {description}
          </div>
        );
      },
    },
  ];
}

/** The two activity filters (time window + category) as bare `<Select>`s. No
 * wrapper, so the detail-page card header and the dedicated-page toolbar each
 * supply their own container. */
export function ActivityFilterSelects({
  timeWindow,
  onTimeWindow,
  typeFilter,
  onTypeFilter,
}: {
  timeWindow: TimeWindow;
  onTimeWindow: (window: TimeWindow) => void;
  typeFilter: TypeFilter;
  onTypeFilter: (filter: TypeFilter) => void;
}): JSX.Element {
  const t = useTranslations('activity');

  return (
    <>
      <Select
        selectSize="md"
        value={timeWindow}
        onChange={(e) => { onTimeWindow(e.target.value as TimeWindow); }}
        className="w-auto min-w-0"
      >
        <option value="all">{t('timeAll')}</option>
        <option value="1h">{t('timeLastHour')}</option>
        <option value="24h">{t('timeLast24h')}</option>
        <option value="7d">{t('timeLast7d')}</option>
        <option value="30d">{t('timeLast30d')}</option>
      </Select>
      <Select
        selectSize="md"
        value={typeFilter}
        onChange={(e) => { onTypeFilter(e.target.value as TypeFilter); }}
        className="w-auto min-w-0"
      >
        <option value="all">{t('typeAll')}</option>
        <option value="upload">{t('typeUploads')}</option>
        <option value="scan">{t('typeScans')}</option>
        <option value="create">{t('typeCreate')}</option>
        <option value="change">{t('typeChanges')}</option>
        <option value="delete">{t('typeDelete')}</option>
      </Select>
    </>
  );
}
