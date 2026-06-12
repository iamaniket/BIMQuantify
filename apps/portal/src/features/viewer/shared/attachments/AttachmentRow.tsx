'use client';

import { CalendarDays, Download, Eye, FileAudio, FileText, FileVideo, Image, Layers } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import { DetailCard, DetailCardRow } from '@bimstitch/ui';

import { RowAsideStat } from '@/components/shared/resource';
import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';
import { ExpandedBody } from './ExpandedBody';

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  attachment: Attachment;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onDelete: () => void;
};

export function AttachmentRow({
  attachment,
  projectId,
  expanded,
  onToggle,
  onView,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('viewerAttachments');
  const { tokens } = useAuth();

  const handleDownload = useCallback(async () => {
    if (tokens === null) return;
    try {
      const resp = await getAttachmentDownloadUrl(
        tokens.access_token,
        projectId,
        attachment.id,
      );
      window.open(resp.download_url, '_blank');
    } catch {
      toast.error(t('downloadError'));
    }
  }, [tokens, projectId, attachment.id, t]);

  const CategoryIcon = CATEGORY_ICONS[attachment.attachment_category ?? 'other'] ?? FileText;

  return (
    <DetailCard expanded={expanded} onToggle={onToggle}>
      <DetailCardRow
        media={
          <CategoryIcon className="h-7 w-7 shrink-0 text-foreground-secondary" aria-hidden />
        }
        aside={
          <>
            {attachment.version_number > 1 && (
              <RowAsideStat icon={Layers} value={`v${String(attachment.version_number)}`} title={t('expandedVersion')} />
            )}
            <RowAsideStat icon={CalendarDays} value={formatDate(attachment.created_at)} title={t('expandedAdded')} />
          </>
        }
        actions={
          <>
            <button
              type="button"
              title={t('expandedView')}
              onClick={(e) => { e.stopPropagation(); onView(); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              type="button"
              title={t('expandedDownload')}
              // eslint-disable-next-line no-void
              onClick={(e) => { e.stopPropagation(); void handleDownload(); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Download className="h-4 w-4" />
            </button>
          </>
        }
      >
        <div className="truncate text-body3 font-semibold leading-tight text-foreground">
          {attachment.original_filename}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          <span className="shrink-0">{formatSize(attachment.size_bytes)}</span>
          {attachment.uploaded_by_name !== null && (
            <>
              <span className="shrink-0">·</span>
              <span className="truncate">{attachment.uploaded_by_name}</span>
            </>
          )}
        </div>
      </DetailCardRow>

      <ExpandedBody
        attachment={attachment}
        onView={onView}
        onDownload={() => { void handleDownload(); }}
        onDelete={onDelete}
      />
    </DetailCard>
  );
}
