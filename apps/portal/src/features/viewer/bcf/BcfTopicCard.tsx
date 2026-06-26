'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { formatDate } from '@/lib/formatting/dates';
import type { BcfTopicSummary } from '@/lib/api/schemas/bcf';

type Props = {
  topic: BcfTopicSummary;
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-yellow-500/15 text-yellow-700',
  'In Progress': 'bg-blue-500/15 text-blue-700',
  Closed: 'bg-green-500/15 text-green-700',
  Resolved: 'bg-green-500/15 text-green-700',
};

const PRIORITY_COLORS: Record<string, string> = {
  High: 'text-red-600',
  Medium: 'text-yellow-600',
  Low: 'text-foreground-tertiary',
};

export function BcfTopicCard({ topic }: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const locale = useLocale() as Locale;
  const statusClass = STATUS_COLORS[topic.topic_status] ?? 'bg-surface-low text-foreground-secondary';
  const priorityClass = PRIORITY_COLORS[topic.priority ?? ''] ?? '';
  const date = formatDate(topic.creation_date, locale);

  return (
    <div className="flex items-center gap-2.5">
      {/* Thumbnail */}
      {topic.snapshot_url !== undefined && topic.snapshot_url !== null ? (
        <img
          src={topic.snapshot_url}
          alt=""
          className="h-10 w-14 shrink-0 rounded border border-border object-cover"
        />
      ) : (
        <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded border border-border bg-surface-low">
          <span className="text-[10px] text-foreground-tertiary">BCF</span>
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-body3 font-medium text-foreground">
          {topic.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex rounded-full px-1.5 py-px text-[10px] font-medium',
              statusClass,
            )}
          >
            {topic.topic_status}
          </span>
          {topic.priority !== null && (
            <span className={cn('text-[10px] font-medium', priorityClass)}>
              {topic.priority}
            </span>
          )}
          {/* Dimension (2D/3D) — issues differ fundamentally by viewer type. */}
          <span className="inline-flex rounded-full bg-surface-low px-1.5 py-px text-[10px] font-medium text-foreground-secondary tabular-nums">
            {topic.is_2d ? t('dimension.2d') : t('dimension.3d')}
          </span>
          {/* Model version the issue was raised against. */}
          {topic.model_version != null && (
            <span className="inline-flex rounded-full bg-surface-low px-1.5 py-px text-[10px] font-medium text-foreground-tertiary tabular-nums">
              {t('versionBadge', { version: topic.model_version })}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-foreground-tertiary">
          {topic.creation_author} &middot; {date}
        </p>
      </div>
    </div>
  );
}
