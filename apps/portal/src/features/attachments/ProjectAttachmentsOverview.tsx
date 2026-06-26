'use client';

import {
  Activity,
  Boxes,
  Clock,
  FileAudio,
  FileText,
  FileVideo,
  Image,
  LayoutGrid,
  Paperclip,
  Scale,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ComponentType, type JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { ChartBarRow } from '@/components/shared/charts/ChartBarRow';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { formatDate, formatMonthDay } from '@/lib/formatting/dates';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';

import { formatSize } from './attachmentMeta';

type Props = {
  attachments: Attachment[];
  /** When provided, recent rows become clickable and open the file viewer. */
  onView?: (att: Attachment) => void;
};

const CATEGORY_KEYS: AttachmentCategoryValue[] = ['image', 'video', 'audio', 'office', 'other'];

const CATEGORY_ICON: Record<AttachmentCategoryValue, ComponentType<{ className?: string }>> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

// Donut/bar colors — one per category, reused for the legend dots and storage
// bars so the two views read as the same palette.
const CATEGORY_COLORS: Record<AttachmentCategoryValue, string> = {
  image: 'var(--primary)',
  video: 'var(--info)',
  audio: 'var(--warning)',
  office: 'var(--success)',
  other: 'var(--foreground-tertiary)',
};

const TREND_WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

export function ProjectAttachmentsOverview({ attachments, onView }: Props): JSX.Element {
  const t = useTranslations('attachments.hub.overview');
  const tCat = useTranslations('attachments.hub.category');
  const locale = useLocale() as Locale;

  const total = attachments.length;

  const byCategory = useMemo(() => {
    const counts: Record<AttachmentCategoryValue, number> = {
      image: 0, video: 0, audio: 0, office: 0, other: 0,
    };
    for (const a of attachments) counts[a.attachment_category ?? 'other'] += 1;
    return counts;
  }, [attachments]);

  const bytesByCategory = useMemo(() => {
    const bytes: Record<AttachmentCategoryValue, number> = {
      image: 0, video: 0, audio: 0, office: 0, other: 0,
    };
    for (const a of attachments) bytes[a.attachment_category ?? 'other'] += a.size_bytes;
    return bytes;
  }, [attachments]);

  const totalBytes = useMemo(
    () => attachments.reduce((sum, a) => sum + a.size_bytes, 0),
    [attachments],
  );

  const categorySegments = useMemo<DonutSegment[]>(
    () => CATEGORY_KEYS.map((k) => ({
      value: byCategory[k],
      color: CATEGORY_COLORS[k],
      label: tCat(k),
    })),
    [byCategory, tCat],
  );

  // Categories with at least one byte, heaviest first.
  const storageRows = useMemo(
    () => CATEGORY_KEYS
      .map((k) => ({ key: k, bytes: bytesByCategory[k] }))
      .filter((r) => r.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes),
    [bytesByCategory],
  );

  // Attachments added per week over the last TREND_WEEKS weeks.
  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const start = today.getTime() - (TREND_WEEKS - 1) * MS_WEEK;
    const values = new Array<number>(TREND_WEEKS).fill(0);
    for (const a of attachments) {
      const ts = new Date(a.created_at).getTime();
      if (!Number.isNaN(ts)) {
        let idx = Math.floor((ts - start) / MS_WEEK);
        if (idx >= TREND_WEEKS) idx = TREND_WEEKS - 1; // clamp future-dated
        if (idx >= 0) values[idx] = (values[idx] ?? 0) + 1;
      }
    }
    const labels = values.map(
      (_, i) => formatMonthDay(new Date(start + i * MS_WEEK).toISOString(), locale),
    );
    return { values, labels };
  }, [attachments, locale]);

  const recent = useMemo(
    () => [...attachments]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5),
    [attachments],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('total')}
          value={total}
          icon={<Paperclip className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('images')}
          value={byCategory.image}
          icon={<Image className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('documents')}
          value={byCategory.office}
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('totalSize')}
          value={formatSize(totalBytes)}
          icon={<Boxes className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Category mix donut + legend */}
        <ChartSection icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />} title={t('byCategoryTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={categorySegments}
                centerValue={String(total)}
                centerLabel={t('donutCenterLabel')}
                size={180}
              />
              <ul className="flex min-w-0 flex-1 flex-col gap-2">
                {CATEGORY_KEYS.map((k) => (
                  <li key={k} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[k] }} />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{tCat(k)}</span>
                    <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{byCategory[k]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartSection>

        {/* Storage by category */}
        <ChartSection icon={<Scale className="h-3.5 w-3.5" aria-hidden />} title={t('storageTitle')}>
          {storageRows.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {storageRows.map((r) => (
                <ChartBarRow
                  key={r.key}
                  label={tCat(r.key)}
                  count={r.bytes}
                  total={totalBytes}
                  color={CATEGORY_COLORS[r.key]}
                  valueLabel={formatSize(r.bytes)}
                  valueClassName="w-16"
                />
              ))}
            </div>
          )}
        </ChartSection>

        {/* Added over time */}
        <ChartSection
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          title={t('trendTitle')}
          className="lg:col-span-2"
        >
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('trendEmpty')}</p>
          ) : (
            <TrendArea values={trend.values} labels={trend.labels} height={200} />
          )}
        </ChartSection>

        {/* Recently added */}
        <ChartSection
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          title={t('recentTitle')}
          className="lg:col-span-2"
        >
          {recent.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recent.map((att) => {
                const Icon = CATEGORY_ICON[att.attachment_category ?? 'other'];
                return (
                  <li key={att.id}>
                    <button
                      type="button"
                      onClick={() => { if (onView !== undefined) onView(att); }}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-foreground-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">{att.original_filename}</span>
                      <span className="shrink-0 font-sans text-caption text-foreground-tertiary tabular-nums">
                        {formatSize(att.size_bytes)}
                      </span>
                      <span className="shrink-0 text-caption text-foreground-tertiary tabular-nums">
                        {formatDate(att.created_at, locale)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartSection>
      </div>
    </div>
  );
}
