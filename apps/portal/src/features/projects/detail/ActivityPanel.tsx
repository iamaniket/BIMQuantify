'use client';

import { useMemo, useState, type JSX } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@bimstitch/i18n';
import { Select } from '@bimstitch/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { listProjectActivityPage } from '@/lib/api/activity';
import type { ActivityCategory, ProjectActivityEntry } from '@/lib/api/schemas/activity';
import { formatDateTime } from '@/lib/formatting/dates';
import { useTableQuery } from '@/lib/query/useTableQuery';
import { projectActivityKey } from '@/features/projects/queryKeys';

type TimeWindow = 'all' | '1h' | '24h' | '7d' | '30d';
type TypeFilter = 'all' | ActivityCategory;

const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100] as const;

const TIME_DURATIONS: Record<Exclude<TimeWindow, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

function computeSince(window: TimeWindow): string | undefined {
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

type ActivityFilters = {
  category: ActivityCategory | undefined;
  since: string | undefined;
};

type ActivityPanelProps = {
  projectId: string;
};

export function ActivityPanel({ projectId }: ActivityPanelProps): JSX.Element {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const t = useTranslations('activity');
  const locale = useLocale() as Locale;

  const since = useMemo(() => computeSince(timeWindow), [timeWindow]);
  const filters = useMemo<ActivityFilters>(
    () => ({ category: typeFilter === 'all' ? undefined : typeFilter, since }),
    [typeFilter, since],
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

  const columns: Column<ProjectActivityEntry>[] = [
    {
      header: t('colWhen'),
      sortKey: 'created_at',
      className: 'whitespace-nowrap font-sans text-caption text-foreground-tertiary',
      cell: (entry) => formatDateTime(entry.created_at, locale),
    },
    {
      header: t('colActor'),
      // Tight column: just the avatar. Full name shows on hover via UserAvatar's title.
      className: 'w-[1%] whitespace-nowrap',
      cell: (entry) => <UserAvatar name={entry.actor_name ?? t('systemActor')} size="sm" />,
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
      header: t('colActivity'),
      className: 'font-sans text-body3',
      // Cap the width so long file names stay on one line and ellipsize;
      // the full text is available on hover via title.
      cell: (entry) => {
        const i18nKey = ACTION_I18N_KEY[entry.action];
        const description = i18nKey !== undefined ? t(i18nKey, descriptionParams(entry)) : entry.action;
        return (
          <div className="max-w-[240px] truncate text-foreground" title={description}>
            {description}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      {/* Header — eyebrow/title + count left, two dropdowns right */}
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-2.5 pt-4">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            {t('title')}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="font-sans text-[17px] font-bold leading-tight tracking-tight text-foreground tabular-nums">
              {t('events', { count: table.total })}
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Select
            selectSize="md"
            value={timeWindow}
            onChange={(e) => { setTimeWindow(e.target.value as TimeWindow); }}
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
            onChange={(e) => { setTypeFilter(e.target.value as TypeFilter); }}
            className="w-auto min-w-0"
          >
            <option value="all">{t('typeAll')}</option>
            <option value="upload">{t('typeUploads')}</option>
            <option value="scan">{t('typeScans')}</option>
            <option value="create">{t('typeCreate')}</option>
            <option value="change">{t('typeChanges')}</option>
            <option value="delete">{t('typeDelete')}</option>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={table.rows}
        rowKey={(e) => e.id}
        emptyMessage={t('noActivity')}
        sort={table.sort}
        onToggleSort={table.toggleSort}
        isLoading={table.isLoading}
        isFetching={table.isFetching}
        isError={table.isError}
        errorMessage={t('loadError')}
        rowClassName="hover:bg-background-hover"
      />

      <TablePaginationFooter
        table={table}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        className="shrink-0 border-t border-border px-4 py-2.5"
      />
    </div>
  );
}
