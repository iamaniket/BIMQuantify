'use client';

import {
  ChevronDown,
  Download,
  Eye,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { cn } from '@bimstitch/ui';

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
  const [hovered, setHovered] = useState(false);

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
    <div className={cn(
      'border-t border-border transition-colors',
      expanded && 'bg-surface-low',
    )}>
      {/* Main row */}
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={() => { setHovered(true); }}
        onMouseLeave={() => { setHovered(false); }}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
        className={cn(
          'grid cursor-pointer items-center gap-3 px-3 py-2.5',
          expanded
            ? 'border-l-2 border-l-primary pl-[10px]'
            : 'border-l-2 border-l-transparent',
          !expanded && hovered && 'bg-background-hover',
        )}
        style={{ gridTemplateColumns: '40px 1fr auto' }}
      >
        <AttachmentThumbnail
          attachment={attachment}
          projectId={projectId}
          size={undefined}
          className={undefined}
        />

        <div className="min-w-0 overflow-hidden">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="flex-1 truncate text-body3 font-semibold leading-tight text-foreground tracking-tight">
              {attachment.original_filename}
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-hidden font-mono text-[11px] leading-tight text-foreground-tertiary tabular-nums">
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
        </div>

        {/* Action cluster */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title={t('expandedView')}
            onClick={(e) => { e.stopPropagation(); onView(); }}
            className={cn(
              'inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all',
              'hover:bg-background-hover hover:text-foreground',
              (hovered || expanded) ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t('expandedDownload')}
            // eslint-disable-next-line no-void
            onClick={(e) => { e.stopPropagation(); void handleDownload(); }}
            className={cn(
              'inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all',
              'hover:bg-background-hover hover:text-foreground',
              (hovered || expanded) ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={expanded ? t('rowCollapse') : t('rowExpand')}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
          >
            <ChevronDown className={cn(
              'h-3 w-3 transition-transform duration-150',
              expanded && 'rotate-180',
            )} />
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <ExpandedBody
          attachment={attachment}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
