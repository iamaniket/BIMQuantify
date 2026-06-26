'use client';

import { Skeleton } from '@bimdossier/ui';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { formatDate } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';

import type { VersionEntry } from './VersionHistoryList';

/**
 * Timeline rendering of a resource's version history — a vertical spine with a
 * node per version, the head tagged "latest". Used by the Models tab; the flat
 * {@link VersionHistoryList} stays the default for other resources (Certificates).
 * Backed by the same {@link VersionEntry} shape; shows `v0n · filename · size ·
 * date` (+ uploader when known). Read-only by default; pass `renderActions` to
 * add a per-version action (e.g. F7 "Restore" on non-head versions).
 */
type Props = {
  /** Newest version first. */
  versions: VersionEntry[];
  isLoading?: boolean;
  /**
   * Which entry is the current head. When set, the "current" badge follows this
   * id (it may be an older version after a restore); when omitted, the newest
   * (index 0) is treated as head — the historical default.
   */
  headId?: string | undefined;
  /** Optional per-version action slot, rendered at the row's trailing edge. */
  renderActions?: ((entry: VersionEntry, isHead: boolean) => ReactNode) | undefined;
};

export function VersionTimeline({
  versions,
  isLoading,
  headId,
  renderActions,
}: Props): JSX.Element {
  const t = useTranslations('common.versions');
  const locale = useLocale() as Locale;

  if (isLoading === true) {
    return (
      <div className="mt-2 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-border bg-surface-main px-3 py-4 text-center text-body3 text-foreground-tertiary">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="relative mt-1 pl-[22px]">
      {/* spine */}
      <div className="absolute bottom-3 left-[5px] top-[7px] w-[2px] rounded bg-border" />
      <div className="flex flex-col">
        {versions.map((v, i) => {
          const isHead = headId !== undefined ? v.id === headId : i === 0;
          return (
            <div key={v.id} className="relative flex items-start gap-3 py-[7px]">
              {/* node */}
              <span
                className={[
                  'absolute left-[-22px] top-[9px] size-3 rounded-full border-2',
                  isHead
                    ? 'border-primary bg-primary shadow-[0_0_0_3px_var(--primary-light)]'
                    : 'border-border-hover bg-surface-main',
                ].join(' ')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-sans text-body3 font-bold tabular-nums ${
                      isHead ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    v{String(v.versionNumber).padStart(2, '0')}
                  </span>
                  {isHead && (
                    <span className="rounded-sm bg-primary px-1.5 py-px text-caption font-bold uppercase text-primary-foreground">
                      {t('latest')}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-foreground-tertiary tabular-nums">
                  <span className="min-w-0 truncate">{v.filename}</span>
                  {v.sizeBytes !== undefined && v.sizeBytes !== null && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{formatFileSize(v.sizeBytes)}</span>
                    </>
                  )}
                  {v.createdAt !== undefined && v.createdAt !== null && v.createdAt !== '' && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{formatDate(v.createdAt, locale)}</span>
                    </>
                  )}
                  {v.uploadedByName !== undefined && v.uploadedByName !== null && v.uploadedByName !== '' && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="truncate">{v.uploadedByName}</span>
                    </>
                  )}
                </div>
              </div>
              {renderActions !== undefined && (
                <div className="shrink-0">{renderActions(v, isHead)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
