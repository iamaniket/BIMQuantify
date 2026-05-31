'use client';

import {
  Download,
  Eye,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import { DetailCard, DetailCardRow } from '@bimstitch/ui';

import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import type { Attachment } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { AttachmentThumbnail } from './AttachmentThumbnail';
import { ExpandedBody } from './ExpandedBody';
import { LinkChip } from './LinkChip';

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

  return (
    <DetailCard expanded={expanded} onToggle={onToggle}>
      <DetailCardRow
        media={
          <AttachmentThumbnail
            attachment={attachment}
            projectId={projectId}
            size={undefined}
            className={undefined}
          />
        }
        actions={
          <>
            <button
              type="button"
              title={t('expandedView')}
              onClick={(e) => { e.stopPropagation(); onView(); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('expandedDownload')}
              // eslint-disable-next-line no-void
              onClick={(e) => { e.stopPropagation(); void handleDownload(); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="truncate text-body3 font-semibold leading-tight text-foreground">
          {attachment.original_filename}
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
          <span className="shrink-0">{formatSize(attachment.size_bytes)}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatDate(attachment.created_at)}</span>
          {attachment.uploaded_by_name !== null && (
            <>
              <span className="shrink-0">·</span>
              <span className="truncate">{attachment.uploaded_by_name}</span>
            </>
          )}
          {(attachment.linked_element_global_id !== null || attachment.linked_point !== null) && (
            <>
              <span className="shrink-0">·</span>
              <LinkChip attachment={attachment} compact />
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
