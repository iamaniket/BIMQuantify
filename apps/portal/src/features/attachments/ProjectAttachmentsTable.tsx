'use client';

import { Camera, Download, Eye, FileAudio, FileText, FileVideo, Image, Trash2 } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { ComponentType, JSX } from 'react';

import { Badge } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';

import { formatSize } from './attachmentMeta';

type Props = {
  table: TablePagination<Attachment>;
  canDelete: boolean;
  onView: (att: Attachment) => void;
  onDownload: (att: Attachment) => void;
  onDelete: (att: Attachment) => void;
};

const CATEGORY_ICON: Record<AttachmentCategoryValue, ComponentType<{ className?: string }>> = {
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  office: FileText,
  other: FileText,
};

const actionBtn = 'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground';

export function ProjectAttachmentsTable({
  table,
  canDelete,
  onView,
  onDownload,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('attachments.hub');
  const tCat = useTranslations('attachments.hub.category');
  const tAtt = useTranslations('projectDetail.tabs.attachments');
  const locale = useLocale() as Locale;

  const columns: Column<Attachment>[] = [
    {
      header: t('columns.file'),
      sortKey: 'filename',
      cell: (att) => {
        const Icon = CATEGORY_ICON[att.attachment_category ?? 'other'];
        return (
          <div className="flex items-center gap-2.5">
            <Icon className="h-5 w-5 shrink-0 text-foreground-secondary" />
            <span className="min-w-0 truncate font-medium text-foreground">{att.original_filename}</span>
          </div>
        );
      },
    },
    {
      header: t('columns.category'),
      sortKey: 'category',
      cell: (att) => (
        <Badge variant="default" size="md" bordered>
          {tCat(att.attachment_category ?? 'other')}
        </Badge>
      ),
    },
    {
      header: t('columns.size'),
      sortKey: 'size',
      className: 'text-foreground-secondary tabular-nums',
      cell: (att) => formatSize(att.size_bytes),
    },
    {
      header: t('columns.uploadedBy'),
      className: 'text-foreground-secondary',
      cell: (att) => {
        if (att.uploaded_by_name !== null) return att.uploaded_by_name;
        if (att.capture_link_id !== null) {
          return (
            <span className="inline-flex items-center gap-1 text-foreground-tertiary">
              <Camera className="h-3.5 w-3.5" />
              {tAtt('viaCapture')}
            </span>
          );
        }
        return '—';
      },
    },
    {
      header: t('columns.added'),
      sortKey: 'created_at',
      className: 'text-foreground-tertiary tabular-nums',
      cell: (att) => formatDate(att.created_at, locale),
    },
    {
      header: '',
      headerClassName: 'text-right',
      cell: (att) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" title={t('columns.view')} onClick={() => { onView(att); }} className={actionBtn}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" title={t('columns.download')} onClick={() => { onDownload(att); }} className={actionBtn}>
            <Download className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              title={t('columns.delete')}
              onClick={() => { onDelete(att); }}
              className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(a) => a.id}
      emptyMessage={t('list.empty')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={t('list.loadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
