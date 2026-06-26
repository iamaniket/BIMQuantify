'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { formatMonthDay } from '@/lib/formatting/dates';

import type { ActivitySlot } from './ActivityTimelinePanel';

/** Display order + i18n key + token-driven dot color for the feed categories.
 * Reuses the existing `activity.type*` labels (shared with the feed filter) and
 * the design-token color utilities — no new tokens, no raw hex. */
const CATEGORY_ROWS: readonly { key: string; labelKey: string; dot: string }[] = [
  { key: 'create', labelKey: 'typeCreate', dot: 'bg-success' },
  { key: 'change', labelKey: 'typeChanges', dot: 'bg-info' },
  { key: 'upload', labelKey: 'typeUploads', dot: 'bg-primary' },
  { key: 'scan', labelKey: 'typeScans', dot: 'bg-warning' },
  { key: 'delete', labelKey: 'typeDelete', dot: 'bg-error' },
];

/** How many resource-type rows to show before folding the rest into "+N more". */
const MAX_RESOURCE_ROWS = 4;

/** Title-case a raw resource_type ("project_file" -> "Project file") as a
 * fallback for any type without an `activity.resource.<type>` label. */
export function humanizeResource(type: string): string {
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Hover card for one point of the Activity-over-time chart: the week's total,
 * a per-category breakdown (colored dots), and a secondary per-resource list.
 * Token-styled throughout; the trailing in-progress week reads "This week so
 * far" instead of a date so the chart's low rightmost point is self-explained. */
export function ActivityTrendTooltip({ slot }: { slot: ActivitySlot }): JSX.Element {
  const t = useTranslations('activity');
  const locale = useLocale() as Locale;

  const header = slot.isCurrentWeek
    ? t('trendTooltipThisWeek')
    : t('trendTooltipWeekOf', {
      date: formatMonthDay(new Date(slot.weekStartMs).toISOString(), locale),
    });

  const categories = CATEGORY_ROWS.filter((c) => (slot.byCategory[c.key] ?? 0) > 0);

  const resources = Object.entries(slot.byResource).sort((a, b) => b[1] - a[1]);
  const topResources = resources.slice(0, MAX_RESOURCE_ROWS);
  const moreTypes = resources.length - topResources.length;

  return (
    <div className="min-w-[180px] max-w-[240px] rounded-md border border-border bg-surface-low p-2.5 shadow-md">
      <div className="text-caption font-bold uppercase tracking-wide text-foreground-tertiary">
        {header}
      </div>
      <div className="mt-0.5 text-body3 font-bold text-foreground">
        {t('trendTooltipTotal', { count: slot.value })}
      </div>

      {categories.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {categories.map((c) => (
            <div
              key={c.key}
              className="flex items-center gap-1.5 text-body3 text-foreground-secondary"
            >
              <span className={`size-2 shrink-0 rounded-full ${c.dot}`} />
              <span className="flex-1 truncate">{t(c.labelKey)}</span>
              <span className="font-bold tabular-nums text-foreground">
                {slot.byCategory[c.key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {topResources.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="text-caption font-bold uppercase tracking-wide text-foreground-tertiary">
            {t('trendTooltipByType')}
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {topResources.map(([type, n]) => (
              <div
                key={type}
                className="flex items-center gap-1.5 text-body3 text-foreground-secondary"
              >
                <span className="flex-1 truncate">
                  {t.has(`resource.${type}`) ? t(`resource.${type}`) : humanizeResource(type)}
                </span>
                <span className="font-bold tabular-nums text-foreground">{n}</span>
              </div>
            ))}
            {moreTypes > 0 && (
              <div className="text-caption text-foreground-tertiary">
                {t('trendTooltipMore', { count: moreTypes })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
