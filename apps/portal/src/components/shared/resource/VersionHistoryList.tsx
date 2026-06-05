'use client';

import { Download } from '@bimstitch/ui/icons';
import { Skeleton } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * The inline version list rendered inside an expanded resource card. One shared
 * layout for Models (`ProjectFile[]`) and Certificates (version-history query):
 * the head version is tagged "latest", each row shows `v0n` + filename/size/date.
 * Callers normalise their data into `VersionEntry[]` (newest first).
 */
export type VersionEntry = {
  id: string;
  versionNumber: number;
  filename: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  uploadedByName?: string | null;
};

type Props = {
  /** Newest version first. */
  versions: VersionEntry[];
  isLoading?: boolean;
  /** Per-version download affordance. Omit to render a read-only list. */
  onDownload?: (id: string) => void;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return value.slice(0, 10);
}

export function VersionHistoryList({ versions, isLoading, onDownload }: Props): JSX.Element {
  const t = useTranslations('common.versions');

  if (isLoading === true) {
    return (
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-background">
      {versions.length === 0 ? (
        <div className="px-3 py-4 text-center text-body3 text-foreground-tertiary">
          {t('empty')}
        </div>
      ) : (
        versions.map((v, i) => {
          const isLatest = i === 0;
          return (
            <div
              key={v.id}
              className={`grid grid-cols-[96px_1fr_auto] items-center gap-2 px-3 py-1.5 text-body3 ${
                i < versions.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 font-sans font-bold">
                <span className={isLatest ? 'text-primary' : 'text-foreground'}>
                  v{String(v.versionNumber).padStart(2, '0')}
                </span>
                {isLatest && (
                  <span className="rounded-sm bg-primary px-1.5 py-px text-caption font-bold uppercase text-primary-foreground">
                    {t('latest')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 overflow-hidden text-caption text-foreground-tertiary tabular-nums">
                <span className="truncate">{v.filename}</span>
                {v.sizeBytes !== undefined && v.sizeBytes !== null && (
                  <>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">{formatSize(v.sizeBytes)}</span>
                  </>
                )}
                {v.createdAt !== undefined && v.createdAt !== null && v.createdAt !== '' && (
                  <>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">{formatDate(v.createdAt)}</span>
                  </>
                )}
                {v.uploadedByName !== undefined && v.uploadedByName !== null && v.uploadedByName !== '' && (
                  <>
                    <span className="shrink-0">·</span>
                    <span className="truncate">{v.uploadedByName}</span>
                  </>
                )}
              </div>
              {onDownload !== undefined && (
                <button
                  type="button"
                  title={t('download')}
                  onClick={() => { onDownload(v.id); }}
                  className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
