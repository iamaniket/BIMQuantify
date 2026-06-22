'use client';

import { FileAudio, FileText, FileVideo, Image, Paperclip } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ComponentType, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { formatDate } from '@/lib/formatting/dates';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';

import { formatSize } from './attachmentMeta';

type Props = {
  attachments: Attachment[];
};

const CATEGORY_KEYS: AttachmentCategoryValue[] = ['image', 'video', 'audio', 'office', 'other'];

const CATEGORY_ICON: Record<AttachmentCategoryValue, ComponentType<{ className?: string }>> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

export function ProjectAttachmentsOverview({ attachments }: Props): JSX.Element {
  const t = useTranslations('attachments.hub.overview');
  const tCat = useTranslations('attachments.hub.category');
  const locale = useLocale() as Locale;

  const byCategory = useMemo(() => {
    const counts: Record<AttachmentCategoryValue, number> = {
      image: 0, video: 0, audio: 0, office: 0, other: 0,
    };
    for (const a of attachments) counts[a.attachment_category ?? 'other']++;
    return counts;
  }, [attachments]);

  const totalBytes = useMemo(
    () => attachments.reduce((sum, a) => sum + a.size_bytes, 0),
    [attachments],
  );

  const recent = useMemo(
    () =>
      [...attachments]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5),
    [attachments],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <Paperclip className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{attachments.length}</div>
              <div className="text-caption text-foreground-tertiary">{t('total')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-foreground-secondary">
              <Image className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{byCategory.image}</div>
              <div className="text-caption text-foreground-tertiary">{t('images')}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-low p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-high text-foreground-secondary">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <div className="text-h4 font-extrabold tabular-nums">{formatSize(totalBytes)}</div>
              <div className="text-caption text-foreground-tertiary">{t('totalSize')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-low p-5">
          <h3 className="mb-4 text-body2 font-bold">{t('byCategoryTitle')}</h3>
          <div className="space-y-3">
            {CATEGORY_KEYS.map((key) => {
              const Icon = CATEGORY_ICON[key];
              return (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
                    <Icon className="h-4 w-4 text-foreground-tertiary" />
                    {tCat(key)}
                  </div>
                  <span className="font-sans text-body3 text-foreground-tertiary tabular-nums">{byCategory[key]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-low p-5">
          <h3 className="mb-4 text-body2 font-bold">{t('recentTitle')}</h3>
          {recent.length === 0 ? (
            <p className="text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="divide-y divide-border">
              {recent.map((att) => {
                const Icon = CATEGORY_ICON[att.attachment_category ?? 'other'];
                return (
                  <div key={att.id} className="flex items-center justify-between py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-foreground-tertiary" />
                      <span className="min-w-0 truncate text-body3 font-medium">{att.original_filename}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-sans text-caption text-foreground-tertiary tabular-nums">
                        {formatSize(att.size_bytes)}
                      </span>
                      <span className="text-caption text-foreground-tertiary tabular-nums">
                        {formatDate(att.created_at, locale)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
