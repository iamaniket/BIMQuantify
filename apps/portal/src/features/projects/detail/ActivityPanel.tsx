'use client';

import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { BlueprintTexture } from '@/components/shared/BlueprintTexture';
import type { ActivityCategory, ProjectActivityEntry } from '@/lib/api/schemas/activity';

import { useProjectActivity } from './useProjectActivity';

type Filter = 'all' | ActivityCategory;

const FILTERS: readonly Filter[] = ['all', 'upload', 'scan', 'change'] as const;

function categoryStyle(category: string): { bg: string; fg: string; glyph: string } {
  switch (category) {
    case 'upload': return { bg: 'rgba(44,86,151,0.10)', fg: 'var(--primary)', glyph: '↑' };
    case 'scan':   return { bg: 'rgba(95,217,158,0.18)', fg: 'var(--success)', glyph: '✓' };
    case 'change': return { bg: 'rgba(169,116,40,0.16)', fg: 'var(--warning)', glyph: '✎' };
    default:       return { bg: 'var(--surface-high)', fg: 'var(--fg-2)', glyph: '·' };
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${String(m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h`;
  const d = Math.floor(h / 24);
  return `${String(d)}d`;
}

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
  'attachment.completed': 'attachmentCompleted',
  'attachment.rejected': 'attachmentRejected',
  'attachment.updated': 'attachmentUpdated',
  'attachment.deleted': 'attachmentDeleted',
};

function descriptionParams(entry: ProjectActivityEntry): Record<string, string> {
  const after = entry.after ?? {};
  return {
    name: String(after['name'] ?? ''),
    filename: String(after['original_filename'] ?? ''),
    framework: String(after['framework'] ?? ''),
    title: String(after['title'] ?? ''),
  };
}

function detailText(entry: ProjectActivityEntry): string {
  const after = entry.after ?? {};
  const parts: string[] = [];

  if (after['file_type'] !== undefined) parts.push(String(after['file_type']).toUpperCase());
  if (after['version_number'] !== undefined) parts.push(`v${String(after['version_number'])}`);
  if (after['ifc_schema'] !== undefined && after['ifc_schema'] !== null) parts.push(String(after['ifc_schema']));
  if (after['rejection_reason'] !== undefined) parts.push(String(after['rejection_reason']));
  if (after['pass_count'] !== undefined) {
    parts.push(`${String(after['pass_count'])} pass · ${String(after['fail_count'] ?? 0)} fail`);
  }
  if (after['discipline'] !== undefined) parts.push(String(after['discipline']));

  return parts.join(' · ');
}

type ActivityPanelProps = {
  projectId: string;
};

export function ActivityPanel({ projectId }: ActivityPanelProps): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const t = useTranslations('activity');

  const category = filter === 'all' ? undefined : filter;
  const { data: entries, isLoading } = useProjectActivity(projectId, category);
  const count = entries?.length ?? 0;

  const filterLabels: Record<Filter, string> = {
    all: t('filterAll'),
    upload: t('filterUploads'),
    scan: t('filterScans'),
    change: t('filterChanges'),
  };

  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <BlueprintTexture />

      {/* Header — filter pill bar left, eyebrow/title right */}
      <div className="relative flex shrink-0 items-center gap-4 px-5 pb-2.5 pt-4">
        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface-high p-[3px]">
          {FILTERS.map((key) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); }}
                className={`rounded-md px-3 py-1.5 text-body3 font-semibold transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-primary hover:bg-primary-light/60 dark:text-primary-light'
                }`}
              >
                {filterLabels[key]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto min-w-0 text-right">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
            {t('title')}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline justify-end gap-2">
            <span className="font-display text-[17px] font-bold leading-tight tracking-tight text-foreground">
              {t('events', { count })}
            </span>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="relative flex-1 overflow-auto px-4 pb-3">
        {isLoading ? (
          <div className="space-y-3 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-7 w-7 shrink-0 rounded-[7px] bg-surface-high" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-surface-high" />
                  <div className="h-2.5 w-1/2 rounded bg-surface-high" />
                </div>
              </div>
            ))}
          </div>
        ) : count === 0 ? (
          <div className="px-2 py-6 text-center text-body3 text-foreground-tertiary">
            {t('noActivity')}
          </div>
        ) : (
          entries?.map((entry) => {
            const s = categoryStyle(entry.category);
            const i18nKey = ACTION_I18N_KEY[entry.action];
            const description = i18nKey !== undefined
              ? t(i18nKey, descriptionParams(entry))
              : entry.action;
            const detail = detailText(entry);

            return (
              <div
                key={entry.id}
                className="flex gap-3 border-b border-dashed border-border py-2.5 last:border-b-0"
              >
                <div
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[12px] font-bold"
                  style={{ background: s.bg, color: s.fg }}
                >
                  {s.glyph}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-tight text-foreground">
                    <span className="font-semibold">{entry.actor_name ?? 'System'}</span>{' '}
                    <span className="text-foreground-tertiary">· {description}</span>
                  </div>
                  {detail.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-foreground-tertiary">{detail}</div>
                  )}
                </div>
                <div className="whitespace-nowrap text-[10.5px] text-foreground-tertiary">
                  {formatRelativeTime(entry.created_at)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
