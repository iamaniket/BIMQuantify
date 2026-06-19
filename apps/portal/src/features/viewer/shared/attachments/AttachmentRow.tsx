'use client';

import { Download, Eye, FileAudio, FileText, FileVideo, Image } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import { CountChip, DetailCard, DetailCardRow } from '@bimstitch/ui';

import { RowActionPill } from '@/components/shared/resource/RowActionPill';
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

type Props = {
  attachment: Attachment;
  projectId: string;
  expanded: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onView: () => void;
  onDelete: () => void;
};

export function AttachmentRow({
  attachment,
  projectId,
  expanded,
  canDelete,
  onToggle,
  onView,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('viewerAttachments');
  const tVer = useTranslations('common.versions');
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
        info={attachment.version_number > 1 ? (
          <CountChip className="rounded-full bg-surface-high px-2 py-0.5 font-semibold">
            {tVer('badge', { n: attachment.version_number })}
          </CountChip>
        ) : undefined}
        actions={
          <>
            <RowActionPill
              size="md"
              icon={<Eye className="h-3.5 w-3.5" />}
              label={t('expandedView')}
              title={t('expandedView')}
              onClick={onView}
            />
            <RowActionPill
              size="md"
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('expandedDownload')}
              title={t('expandedDownload')}
              // eslint-disable-next-line no-void
              onClick={() => { void handleDownload(); }}
            />
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
        canDelete={canDelete}
        onView={onView}
        onDownload={() => { void handleDownload(); }}
        onDelete={onDelete}
      />
    </DetailCard>
  );
}
